import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { dailyProductPlans, products, reservationItems, reservations } from '@/server/db/schema';
import {
    InvalidDailyPlanUpdateError,
    PlanBelowCommitmentsError,
    ProductNotFoundError,
} from '@/server/domain/errors';
import type { ReservationStatus } from '@/server/domain/reservation-rules';
import { updateDailyPlan } from '@/server/services/production/update-daily-plan';

// Far outside any real booking window; the clock is injected relative to these dates.
const DATE = '2099-06-10';
const TODAY = '2099-06-09';
const YESTERDAY = '2099-06-08';
// After the online cutoff for DATE: admins may still edit its plan.
const NOW = pragueTimeToInstant(TODAY, 20);

const createdProductIds: string[] = [];

const insertProduct = async (overrides: Partial<typeof products.$inferInsert> = {}) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Plan test loaf', price: 4500, defaultCapacity: 10, ...overrides })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const insertReservation = async (
    productId: string,
    quantity: number,
    status: ReservationStatus = 'confirmed',
    retainForProduction = false,
) => {
    const [reservation] = await getDb()
        .insert(reservations)
        .values({
            pickupDate: DATE,
            customerName: 'Jane Doe',
            customerPhone: '+420777123456',
            source: 'admin',
            status,
            retainForProduction,
            cancelledAt: status === 'cancelled' ? new Date() : null,
            managementTokenHash: randomUUID(),
            idempotencyKey: randomUUID(),
            requestHash: randomUUID(),
        })
        .returning();
    await getDb().insert(reservationItems).values({
        reservationId: reservation.id,
        productId,
        productNameSnapshot: 'Plan test loaf',
        unitPriceSnapshot: 4500,
        quantity,
    });
};

const readPlan = async (productId: string, date = DATE) => {
    const [plan] = await getDb()
        .select()
        .from(dailyProductPlans)
        .where(and(eq(dailyProductPlans.productId, productId), eq(dailyProductPlans.date, date)));
    return plan;
};

afterEach(async () => {
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

describe('updateDailyPlan', () => {
    it('materializes the plan on first write and returns the production overview', async () => {
        const bread = await insertProduct({ name: 'Rye', defaultCapacity: 10 });
        await insertReservation(bread.id, 3);

        const result = await updateDailyPlan(
            { productId: bread.id.toUpperCase(), date: DATE, capacity: 15, walkInQuantity: 4 },
            { now: NOW },
        );

        expect(result).toEqual({
            productId: bread.id,
            productName: 'Rye',
            capacity: 15,
            activeReserved: 3,
            retainedCancelled: 0,
            walkInQuantity: 4,
            recommendedProduction: 7,
            remainingAvailability: 8,
        });
        expect(await readPlan(bread.id)).toMatchObject({ capacity: 15, walkInQuantity: 4 });
    });

    it('updates an existing plan without touching product defaults', async () => {
        const bread = await insertProduct({ defaultCapacity: 10, defaultWalkInQuantity: 2 });
        await updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 12, walkInQuantity: 3 },
            { now: NOW },
        );

        await updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 6, walkInQuantity: 0 },
            { now: NOW },
        );

        expect(await readPlan(bread.id)).toMatchObject({ capacity: 6, walkInQuantity: 0 });
        const [product] = await getDb().select().from(products).where(eq(products.id, bread.id));
        expect(product).toMatchObject({ defaultCapacity: 10, defaultWalkInQuantity: 2 });
    });

    it('allows capacity exactly at walk-ins plus active and retained commitments', async () => {
        const bread = await insertProduct({ defaultCapacity: 20 });
        await insertReservation(bread.id, 4);
        await insertReservation(bread.id, 2, 'cancelled', true);
        await insertReservation(bread.id, 5, 'cancelled', false);
        await insertReservation(bread.id, 1, 'picked_up');

        const result = await updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 10, walkInQuantity: 3 },
            { now: NOW },
        );

        expect(result).toMatchObject({
            activeReserved: 5,
            retainedCancelled: 2,
            recommendedProduction: 10,
            remainingAvailability: 0,
        });
    });

    it('rejects a plan below walk-ins plus commitments and keeps the existing plan', async () => {
        const bread = await insertProduct({ defaultCapacity: 20 });
        await insertReservation(bread.id, 4);
        await insertReservation(bread.id, 2, 'cancelled', true);
        await updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 20, walkInQuantity: 0 },
            { now: NOW },
        );

        const rejected = updateDailyPlan(
            { productId: bread.id, date: DATE, capacity: 8, walkInQuantity: 3 },
            { now: NOW },
        );

        await expect(rejected).rejects.toBeInstanceOf(PlanBelowCommitmentsError);
        await expect(rejected).rejects.toMatchObject({ committedQuantity: 6 });
        expect(await readPlan(bread.id)).toMatchObject({ capacity: 20, walkInQuantity: 0 });
    });

    it('leaves no plan behind when the first write is rejected', async () => {
        const bread = await insertProduct({ defaultCapacity: 10 });
        await insertReservation(bread.id, 5);

        await expect(
            updateDailyPlan(
                { productId: bread.id, date: DATE, capacity: 4, walkInQuantity: 0 },
                { now: NOW },
            ),
        ).rejects.toBeInstanceOf(PlanBelowCommitmentsError);
        expect(await readPlan(bread.id)).toBeUndefined();
    });

    it('allows today and rejects past dates', async () => {
        const bread = await insertProduct();

        await updateDailyPlan(
            { productId: bread.id, date: TODAY, capacity: 5, walkInQuantity: 1 },
            { now: NOW },
        );
        expect(await readPlan(bread.id, TODAY)).toMatchObject({ capacity: 5 });

        await expect(
            updateDailyPlan(
                { productId: bread.id, date: YESTERDAY, capacity: 5, walkInQuantity: 1 },
                { now: NOW },
            ),
        ).rejects.toMatchObject({
            code: 'INVALID_REQUEST',
            issues: [{ path: 'date', message: 'Plans for past dates cannot be changed.' }],
        });
        expect(await readPlan(bread.id, YESTERDAY)).toBeUndefined();
    });

    it('rejects invalid input with validation issues', async () => {
        const bread = await insertProduct();

        const rejected = updateDailyPlan(
            { productId: bread.id, date: '2099-02-30', capacity: 3, walkInQuantity: 4 },
            { now: NOW },
        );

        await expect(rejected).rejects.toBeInstanceOf(InvalidDailyPlanUpdateError);
        const error = (await rejected.catch(
            (caught: unknown) => caught,
        )) as InvalidDailyPlanUpdateError;
        expect(error.issues.map((issue) => issue.path).sort()).toEqual(['date', 'walkInQuantity']);

        for (const invalid of [
            { capacity: -1, walkInQuantity: 0 },
            { capacity: 1.5, walkInQuantity: 0 },
            { capacity: 2_147_483_648, walkInQuantity: 0 },
        ]) {
            await expect(
                updateDailyPlan({ productId: bread.id, date: DATE, ...invalid }, { now: NOW }),
            ).rejects.toBeInstanceOf(InvalidDailyPlanUpdateError);
        }
        await expect(
            updateDailyPlan(
                { productId: 'not-a-uuid', date: DATE, capacity: 1, walkInQuantity: 0 },
                { now: NOW },
            ),
        ).rejects.toBeInstanceOf(InvalidDailyPlanUpdateError);
    });

    it('rejects an unknown product', async () => {
        const productId = randomUUID();

        await expect(
            updateDailyPlan(
                { productId, date: DATE, capacity: 5, walkInQuantity: 0 },
                { now: NOW },
            ),
        ).rejects.toEqual(new ProductNotFoundError(productId));
    });
});
