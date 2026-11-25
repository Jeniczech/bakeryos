import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    updateDailyPlanAction,
    type DailyPlanFormState,
} from '@/app/admin/(dashboard)/production/actions';
import { addDays, getPragueDate, getWeekday, pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryClosures,
    bakeryOpeningDays,
    dailyProductPlans,
    productWeekdays,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import { PlanChangedError } from '@/server/domain/errors';
import { getReservationCutoff } from '@/server/domain/reservation-rules';
import { getDailyProduction } from '@/server/services/production/get-daily-production';
import { updateDailyPlan } from '@/server/services/production/update-daily-plan';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';
import { createReservation } from '@/server/services/reservations/create-reservation';

const session = vi.hoisted(() => ({
    current: null as { user: { id: string; email: string } } | null,
}));

// Auth.js and the request-scoped Next.js APIs need a request; the session is injected instead.
vi.mock('@/server/auth/auth', () => ({ auth: async () => session.current }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

// Far outside any real booking window and unused by other test files, which run in parallel
// and see the same products on shared dates.
const TODAY = '2099-08-04'; // Tuesday
const DATE = '2099-08-05'; // Wednesday
const CLOSED_DATE = '2099-08-11'; // Tuesday, within the planning window
const BEFORE_CUTOFF = pragueTimeToInstant(TODAY, 12);
const AFTER_CUTOFF = pragueTimeToInstant(TODAY, 20);

const createdProductIds: string[] = [];

const insertProduct = async (overrides: Partial<typeof products.$inferInsert> = {}) => {
    const [product] = await getDb()
        .insert(products)
        .values({
            name: 'Production test loaf',
            price: 4000,
            defaultCapacity: 20,
            defaultWalkInQuantity: 5,
            ...overrides,
        })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const reserve = (productId: string, quantity: number, pickupDate = DATE, now = BEFORE_CUTOFF) =>
    createReservation(
        {
            idempotencyKey: randomUUID(),
            pickupDate,
            customer: { name: 'Jane Doe', phone: '+420777123456' },
            items: [{ productId, quantity }],
            source: 'admin',
        },
        { now },
    );

const readPlan = async (productId: string, date: string) => {
    const [plan] = await getDb()
        .select()
        .from(dailyProductPlans)
        .where(and(eq(dailyProductPlans.productId, productId), eq(dailyProductPlans.date, date)));
    return plan;
};

const findRow = <T extends { productId: string }>(rows: readonly T[], productId: string) =>
    rows.find((row) => row.productId === productId);

beforeAll(async () => {
    // The seed opens Tuesdays and Wednesdays; add the rows only if the schedule is missing.
    await getDb()
        .insert(bakeryOpeningDays)
        .values([TODAY, DATE].map((date) => ({ weekday: getWeekday(date), isOpen: true })))
        .onConflictDoNothing();
});

afterEach(async () => {
    await getDb().delete(bakeryClosures).where(eq(bakeryClosures.date, CLOSED_DATE));
    const productIds = createdProductIds.splice(0);
    if (productIds.length === 0) {
        return;
    }
    const items = await getDb()
        .select({ reservationId: reservationItems.reservationId })
        .from(reservationItems)
        .where(inArray(reservationItems.productId, productIds));
    const reservationIds = items.map((item) => item.reservationId);
    if (reservationIds.length > 0) {
        await getDb()
            .delete(reservationItems)
            .where(inArray(reservationItems.reservationId, reservationIds));
        await getDb().delete(reservations).where(inArray(reservations.id, reservationIds));
    }
    await getDb().delete(dailyProductPlans).where(inArray(dailyProductPlans.productId, productIds));
    await getDb().delete(products).where(inArray(products.id, productIds));
});

afterAll(async () => {
    await closeDb();
});

describe('getDailyProduction', () => {
    it('applies product defaults when no daily plan exists, without creating one', async () => {
        const bread = await insertProduct({
            name: 'Rye',
            defaultCapacity: 12,
            defaultWalkInQuantity: 4,
        });

        const production = await getDailyProduction(DATE, { now: BEFORE_CUTOFF });

        expect(production.dateLock).toBeNull();
        expect(findRow(production.rows, bread.id)).toEqual({
            productId: bread.id,
            productName: 'Rye',
            capacity: 12,
            activeReserved: 0,
            retainedCancelled: 0,
            walkInQuantity: 4,
            recommendedProduction: 4,
            remainingAvailability: 8,
            notice: null,
            editable: true,
        });
        expect(await readPlan(bread.id, DATE)).toBeUndefined();
    });

    it('keeps the first-write plan after the product defaults change', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        await reserve(bread.id, 2);
        await getDb()
            .update(products)
            .set({ defaultCapacity: 50, defaultWalkInQuantity: 10 })
            .where(eq(products.id, bread.id));

        const row = findRow(
            (await getDailyProduction(DATE, { now: BEFORE_CUTOFF })).rows,
            bread.id,
        );

        expect(row).toMatchObject({ capacity: 20, walkInQuantity: 5, activeReserved: 2 });
    });

    it('keeps late cancellations in production and drops early ones', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        await reserve(bread.id, 2);
        const early = await reserve(bread.id, 3);
        const late = await reserve(bread.id, 4);
        await cancelReservation(
            { actor: 'admin', reservationId: early.reservationId },
            { now: BEFORE_CUTOFF },
        );
        await cancelReservation(
            { actor: 'admin', reservationId: late.reservationId },
            { now: getReservationCutoff(DATE) },
        );

        const row = findRow((await getDailyProduction(DATE, { now: AFTER_CUTOFF })).rows, bread.id);

        expect(row).toMatchObject({
            capacity: 20,
            activeReserved: 2,
            retainedCancelled: 4,
            walkInQuantity: 5,
            recommendedProduction: 11,
            remainingAvailability: 9,
            editable: true,
        });
    });

    it('lists products with reservations that are no longer offered, read-only', async () => {
        const reserved = await insertProduct({ name: 'Deactivated with reservations' });
        const unreserved = await insertProduct({ name: 'Deactivated without reservations' });
        const offeredElsewhere = await insertProduct({ name: 'Thursdays only' });
        await getDb()
            .insert(productWeekdays)
            .values({ productId: offeredElsewhere.id, weekday: getWeekday(addDays(DATE, 1)) });
        await reserve(reserved.id, 3);
        await getDb()
            .update(products)
            .set({ active: false })
            .where(inArray(products.id, [reserved.id, unreserved.id]));

        const { rows } = await getDailyProduction(DATE, { now: BEFORE_CUTOFF });

        expect(findRow(rows, reserved.id)).toMatchObject({
            notice: 'INACTIVE',
            editable: false,
            activeReserved: 3,
            recommendedProduction: 8,
        });
        expect(findRow(rows, unreserved.id)).toBeUndefined();
        expect(findRow(rows, offeredElsewhere.id)).toBeUndefined();
    });

    it('shows past dates read-only from stored plans only, never from current defaults', async () => {
        const reserved = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const unplanned = await insertProduct();
        await reserve(reserved.id, 2);
        await getDb()
            .update(products)
            .set({ defaultCapacity: 50, defaultWalkInQuantity: 10, active: false })
            .where(eq(products.id, reserved.id));

        const production = await getDailyProduction(DATE, {
            now: pragueTimeToInstant(addDays(DATE, 1), 9),
        });

        expect(production.dateLock).toBe('PAST_DATE');
        expect(findRow(production.rows, reserved.id)).toMatchObject({
            capacity: 20,
            walkInQuantity: 5,
            activeReserved: 2,
            editable: false,
        });
        expect(findRow(production.rows, unplanned.id)).toBeUndefined();
    });

    it('omits products whose reservations were all released', async () => {
        const bread = await insertProduct();
        const early = await reserve(bread.id, 3);
        await cancelReservation(
            { actor: 'admin', reservationId: early.reservationId },
            { now: BEFORE_CUTOFF },
        );
        await getDb().update(products).set({ active: false }).where(eq(products.id, bread.id));

        const { rows } = await getDailyProduction(DATE, { now: BEFORE_CUTOFF });

        expect(findRow(rows, bread.id)).toBeUndefined();
    });

    it('labels an active product with reservations that is no longer offered that weekday', async () => {
        const bread = await insertProduct();
        await reserve(bread.id, 2);
        await getDb()
            .insert(productWeekdays)
            .values({ productId: bread.id, weekday: getWeekday(addDays(DATE, 1)) });

        const { rows } = await getDailyProduction(DATE, { now: BEFORE_CUTOFF });

        expect(findRow(rows, bread.id)).toMatchObject({
            notice: 'NOT_OFFERED_ON_DATE',
            editable: false,
            activeReserved: 2,
        });
    });

    it('lists no offered products on a closed day, only reserved ones', async () => {
        const bread = await insertProduct();
        await getDb().insert(bakeryClosures).values({ date: CLOSED_DATE });

        const production = await getDailyProduction(CLOSED_DATE, { now: BEFORE_CUTOFF });

        expect(production.dateLock).toBe('BAKERY_CLOSED');
        expect(findRow(production.rows, bread.id)).toBeUndefined();
    });

    it('reports a past closed day as closed', async () => {
        await getDb().insert(bakeryClosures).values({ date: CLOSED_DATE });

        const production = await getDailyProduction(CLOSED_DATE, {
            now: pragueTimeToInstant(addDays(CLOSED_DATE, 1), 9),
        });

        expect(production.dateLock).toBe('BAKERY_CLOSED');
    });

    it('rejects an invalid date', async () => {
        await expect(getDailyProduction('2099-02-30')).rejects.toMatchObject({
            code: 'INVALID_REQUEST',
        });
    });
});

describe('updateDailyPlan with expected values', () => {
    it('rejects a save based on values another admin has since changed', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        await updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 20, walkInQuantity: 12 },
            { now: AFTER_CUTOFF },
        );

        const stale = updateDailyPlan(
            {
                productId: bread.id,
                date: DATE,
                capacity: 25,
                walkInQuantity: 5,
                expected: { capacity: 20, walkInQuantity: 5 },
            },
            { now: AFTER_CUTOFF },
        );

        await expect(stale).rejects.toBeInstanceOf(PlanChangedError);
        await expect(stale).rejects.toMatchObject({
            current: { capacity: 20, walkInQuantity: 12 },
        });
        expect(await readPlan(bread.id, DATE)).toMatchObject({ capacity: 20, walkInQuantity: 12 });
    });

    it('compares a first write with the defaults it materializes, leaving no plan on mismatch', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const input = { productId: bread.id, date: DATE, capacity: 30, walkInQuantity: 5 };

        await expect(
            updateDailyPlan(
                { ...input, expected: { capacity: 18, walkInQuantity: 5 } },
                { now: AFTER_CUTOFF },
            ),
        ).rejects.toBeInstanceOf(PlanChangedError);
        expect(await readPlan(bread.id, DATE)).toBeUndefined();

        await expect(
            updateDailyPlan(
                { ...input, expected: { capacity: 20, walkInQuantity: 5 } },
                { now: AFTER_CUTOFF },
            ),
        ).resolves.toMatchObject({ capacity: 30, walkInQuantity: 5 });
    });
});

describe('updateDailyPlanAction', () => {
    /** A date the real clock lets admins plan; the action does not take an injected clock. */
    let planDate: string;

    /** `expected` defaults to the test products' default plan, as the form would show it. */
    const submit = (
        productId: string,
        capacity: string,
        walkInQuantity: string,
        options: { date?: string; expected?: [string, string] } = {},
    ) => {
        const [expectedCapacity, expectedWalkInQuantity] = options.expected ?? ['20', '5'];
        const formData = new FormData();
        formData.set('productId', productId);
        formData.set('date', options.date ?? planDate);
        formData.set('capacity', capacity);
        formData.set('walkInQuantity', walkInQuantity);
        formData.set('expectedCapacity', expectedCapacity);
        formData.set('expectedWalkInQuantity', expectedWalkInQuantity);
        const initial: DailyPlanFormState = {
            error: null,
            fields: [],
            committedQuantity: null,
            currentPlan: null,
            values: null,
            saved: false,
        };
        return updateDailyPlanAction(initial, formData);
    };

    beforeAll(async () => {
        const now = new Date();
        const today = getPragueDate(now);
        for (let offset = 0; offset <= 7; offset += 1) {
            const date = addDays(today, offset);
            if ((await getDailyProduction(date, { now })).dateLock === null) {
                planDate = date;
                return;
            }
        }
        throw new Error('The seeded schedule has no open day in the planning window.');
    });

    it('redirects an unauthenticated request to the login page without writing', async () => {
        session.current = null;
        const bread = await insertProduct();

        await expect(submit(bread.id, '30', '5')).rejects.toMatchObject({
            digest: expect.stringContaining('/admin/login'),
        });
        expect(await readPlan(bread.id, planDate)).toBeUndefined();
    });

    describe('for a signed-in admin', () => {
        beforeEach(() => {
            session.current = { user: { id: randomUUID(), email: 'admin@example.com' } };
        });

        it('saves an override through the shared service', async () => {
            const bread = await insertProduct();

            await expect(submit(bread.id, '30', '6')).resolves.toMatchObject({
                error: null,
                saved: true,
            });
            expect(await readPlan(bread.id, planDate)).toMatchObject({
                capacity: 30,
                walkInQuantity: 6,
            });
        });

        it('rejects an override below existing reservations and keeps the plan', async () => {
            const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
            await getDb().insert(dailyProductPlans).values({
                productId: bread.id,
                date: planDate,
                capacity: 20,
                walkInQuantity: 5,
            });
            const [reservation] = await getDb()
                .insert(reservations)
                .values({
                    pickupDate: planDate,
                    customerName: 'Jane Doe',
                    customerPhone: '+420777123456',
                    source: 'admin',
                    managementTokenHash: randomUUID(),
                    idempotencyKey: randomUUID(),
                    requestHash: 'test',
                })
                .returning();
            await getDb().insert(reservationItems).values({
                reservationId: reservation.id,
                productId: bread.id,
                productNameSnapshot: bread.name,
                unitPriceSnapshot: bread.price,
                quantity: 8,
            });

            await expect(submit(bread.id, '10', '3')).resolves.toEqual({
                error: 'BELOW_COMMITMENTS',
                fields: ['capacity'],
                committedQuantity: 8,
                currentPlan: null,
                values: { capacity: '10', walkInQuantity: '3' },
                saved: false,
            });
            expect(await readPlan(bread.id, planDate)).toMatchObject({
                capacity: 20,
                walkInQuantity: 5,
            });
            // Exactly walk-ins plus commitments is allowed.
            await expect(submit(bread.id, '11', '3')).resolves.toMatchObject({ saved: true });
        });

        it('returns invalid fields with the submitted values', async () => {
            const bread = await insertProduct();

            await expect(submit(bread.id, '5', '6')).resolves.toMatchObject({
                error: 'INVALID_REQUEST',
                fields: ['walkInQuantity'],
                values: { capacity: '5', walkInQuantity: '6' },
            });
            await expect(submit(bread.id, '1.5', '0')).resolves.toMatchObject({
                error: 'INVALID_REQUEST',
                fields: ['capacity'],
            });
            expect(await readPlan(bread.id, planDate)).toBeUndefined();
        });

        it('rejects a form loaded before another save instead of undoing it', async () => {
            const bread = await insertProduct();
            await expect(submit(bread.id, '20', '12')).resolves.toMatchObject({ saved: true });

            // A second form still showing the defaults the first one replaced.
            await expect(submit(bread.id, '25', '5')).resolves.toEqual({
                error: 'CHANGED',
                fields: [],
                committedQuantity: null,
                currentPlan: { capacity: 20, walkInQuantity: 12 },
                values: { capacity: '25', walkInQuantity: '5' },
                saved: false,
            });
            expect(await readPlan(bread.id, planDate)).toMatchObject({
                capacity: 20,
                walkInQuantity: 12,
            });
        });

        it('logs an unrecognised validation error instead of blaming the date', async () => {
            const bread = await insertProduct();
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

            await expect(
                submit(bread.id, '30', '5', { expected: ['tampered', '5'] }),
            ).resolves.toMatchObject({ error: 'UNAVAILABLE' });
            expect(consoleError).toHaveBeenCalledOnce();
            consoleError.mockRestore();
            expect(await readPlan(bread.id, planDate)).toBeUndefined();
        });

        it('rejects past dates and inactive products', async () => {
            const bread = await insertProduct();
            const inactive = await insertProduct({ active: false });

            await expect(
                submit(bread.id, '30', '5', { date: addDays(getPragueDate(new Date()), -1) }),
            ).resolves.toMatchObject({ error: 'DATE_UNAVAILABLE' });
            await expect(submit(inactive.id, '30', '5')).resolves.toMatchObject({
                error: 'PRODUCT_UNAVAILABLE',
            });
            await expect(submit('not-a-uuid', '30', '5')).resolves.toMatchObject({
                error: 'PRODUCT_UNAVAILABLE',
            });
        });
    });
});
