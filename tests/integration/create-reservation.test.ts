import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    productWeekdays,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import {
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidRequestError,
    OnlineQuantityLimitError,
    PickupDateUnavailableError,
    ProductUnavailableError,
} from '@/server/domain/errors';
import {
    createReservation,
    type CreateReservationInput,
} from '@/server/services/reservations/create-reservation';
import {
    deriveManagementToken,
    hashManagementToken,
} from '@/server/services/reservations/management-token';

// Far outside any real booking window; the clock is injected relative to these dates.
const PICKUP_DATE = '2099-05-13'; // Wednesday
const WEDNESDAY = 3;
const CLOSED_MONDAY = '2099-05-11';
const BEFORE_CUTOFF = pragueTimeToInstant('2099-05-12', 12);
const CUTOFF = pragueTimeToInstant('2099-05-12', 18);

const createdProductIds: string[] = [];

const insertProduct = async (
    overrides: Partial<typeof products.$inferInsert> = {},
    weekdays: number[] = [],
) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Reservation test loaf', price: 4500, defaultCapacity: 10, ...overrides })
        .returning();
    createdProductIds.push(product.id);
    if (weekdays.length > 0) {
        await getDb()
            .insert(productWeekdays)
            .values(weekdays.map((weekday) => ({ productId: product.id, weekday })));
    }
    return product;
};

const buildInput = (
    items: CreateReservationInput['items'],
    overrides: Partial<CreateReservationInput> = {},
): CreateReservationInput => ({
    idempotencyKey: randomUUID(),
    pickupDate: PICKUP_DATE,
    customer: { name: 'Jane Doe', phone: '+420777123456' },
    items,
    source: 'online',
    ...overrides,
});

const readReservations = (productIds: string[]) =>
    getDb()
        .selectDistinct({ id: reservations.id })
        .from(reservations)
        .innerJoin(reservationItems, eq(reservationItems.reservationId, reservations.id))
        .where(inArray(reservationItems.productId, productIds));

const readPlans = (productIds: string[]) =>
    getDb()
        .select()
        .from(dailyProductPlans)
        .where(
            and(
                inArray(dailyProductPlans.productId, productIds),
                eq(dailyProductPlans.date, PICKUP_DATE),
            ),
        );

beforeAll(async () => {
    // The seed opens Wednesdays; add the row only if the schedule is missing entirely.
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: WEDNESDAY, isOpen: true })
        .onConflictDoNothing();
});

afterEach(async () => {
    const productIds = createdProductIds.splice(0);
    if (productIds.length === 0) {
        return;
    }
    const reservationIds = (await readReservations(productIds)).map((row) => row.id);
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

describe('createReservation', () => {
    it('creates a multi-product reservation with snapshots, totals, and a management token', async () => {
        const bread = await insertProduct({ name: 'Sourdough', price: 8900 });
        const roll = await insertProduct({ name: 'Kaiser roll', price: 600 });

        const result = await createReservation(
            buildInput([
                { productId: bread.id, quantity: 2 },
                { productId: roll.id.toUpperCase(), quantity: 3 },
                { productId: roll.id, quantity: 1 },
            ]),
            { now: BEFORE_CUTOFF },
        );

        expect(result).toMatchObject({
            pickupDate: PICKUP_DATE,
            status: 'confirmed',
            totalPrice: 2 * 8900 + 4 * 600,
            replayed: false,
        });
        expect(result.reservationNumber).toMatch(/^BK-\d{6}$/);
        expect(result.managementToken).toBe(deriveManagementToken(result.reservationId));

        const [stored] = await getDb()
            .select()
            .from(reservations)
            .where(eq(reservations.id, result.reservationId));
        expect(stored).toMatchObject({
            source: 'online',
            status: 'confirmed',
            customerName: 'Jane Doe',
            customerPhone: '+420777123456',
            managementTokenHash: hashManagementToken(result.managementToken),
        });
        expect(stored.managementTokenHash).not.toContain(result.managementToken);

        const items = await getDb()
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, result.reservationId));
        expect(items).toHaveLength(2);
        expect(items.find((item) => item.productId === bread.id)).toMatchObject({
            productNameSnapshot: 'Sourdough',
            unitPriceSnapshot: 8900,
            quantity: 2,
        });
        expect(items.find((item) => item.productId === roll.id)).toMatchObject({
            productNameSnapshot: 'Kaiser roll',
            unitPriceSnapshot: 600,
            quantity: 4,
        });
        expect(await readPlans([bread.id, roll.id])).toHaveLength(2);
    });

    it('keeps item snapshots when the product changes later', async () => {
        const bread = await insertProduct({ name: 'Sourdough', price: 8900 });
        const result = await createReservation(buildInput([{ productId: bread.id, quantity: 1 }]), {
            now: BEFORE_CUTOFF,
        });

        await getDb()
            .update(products)
            .set({ name: 'Sourdough XL', price: 9900 })
            .where(eq(products.id, bread.id));

        const [item] = await getDb()
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, result.reservationId));
        expect(item).toMatchObject({ productNameSnapshot: 'Sourdough', unitPriceSnapshot: 8900 });
    });

    it('allows exactly the remaining quantity after walk-ins and commitments', async () => {
        const bread = await insertProduct({ defaultCapacity: 10, defaultWalkInQuantity: 3 });
        await createReservation(buildInput([{ productId: bread.id, quantity: 4 }]), {
            now: BEFORE_CUTOFF,
        });

        const overbooking = createReservation(buildInput([{ productId: bread.id, quantity: 4 }]), {
            now: BEFORE_CUTOFF,
        });
        await expect(overbooking).rejects.toBeInstanceOf(InsufficientCapacityError);
        await expect(overbooking).rejects.toMatchObject({
            shortages: [{ productId: bread.id, requested: 4, available: 3 }],
        });

        await expect(
            createReservation(buildInput([{ productId: bread.id, quantity: 3 }]), {
                now: BEFORE_CUTOFF,
            }),
        ).resolves.toMatchObject({ status: 'confirmed' });
    });

    it('rejects the entire cart when one item is short and writes nothing', async () => {
        const bread = await insertProduct({ defaultCapacity: 10 });
        const roll = await insertProduct({ defaultCapacity: 2 });

        const attempt = createReservation(
            buildInput([
                { productId: bread.id, quantity: 5 },
                { productId: roll.id, quantity: 3 },
            ]),
            { now: BEFORE_CUTOFF },
        );

        await expect(attempt).rejects.toMatchObject({
            code: 'INSUFFICIENT_CAPACITY',
            shortages: [{ productId: roll.id, requested: 3, available: 2 }],
        });
        expect(await readReservations([bread.id, roll.id])).toHaveLength(0);
        expect(await readPlans([bread.id, roll.id])).toHaveLength(0);
    });

    it('rejects every unknown, inactive, or off-weekday product at once', async () => {
        const inactive = await insertProduct({ active: false });
        const weekendOnly = await insertProduct({}, [0, 6]);
        const offered = await insertProduct();
        const unknownId = randomUUID();

        const attempt = createReservation(
            buildInput([
                { productId: inactive.id, quantity: 1 },
                { productId: weekendOnly.id, quantity: 1 },
                { productId: offered.id, quantity: 1 },
                { productId: unknownId, quantity: 1 },
            ]),
            { now: BEFORE_CUTOFF },
        );

        await expect(attempt).rejects.toBeInstanceOf(ProductUnavailableError);
        const error = (await attempt.catch((caught: unknown) => caught)) as ProductUnavailableError;
        expect(error.products).toEqual(
            expect.arrayContaining([
                { productId: inactive.id, reason: 'PRODUCT_INACTIVE' },
                { productId: weekendOnly.id, reason: 'PRODUCT_NOT_OFFERED_ON_DATE' },
                { productId: unknownId, reason: 'PRODUCT_NOT_FOUND' },
            ]),
        );
        expect(error.products).toHaveLength(3);
        expect(await readPlans([inactive.id, weekendOnly.id, offered.id])).toHaveLength(0);
    });

    it('rejects invalid input with validation issues', async () => {
        const attempt = createReservation(
            buildInput([], { customer: { name: ' ', phone: '123' }, pickupDate: '2099-02-30' }),
            { now: BEFORE_CUTOFF },
        );
        await expect(attempt).rejects.toBeInstanceOf(InvalidRequestError);
        const error = (await attempt.catch((caught: unknown) => caught)) as InvalidRequestError;
        expect(error.issues.map((issue) => issue.path)).toEqual(
            expect.arrayContaining(['pickupDate', 'customer.name', 'customer.phone', 'items']),
        );
    });

    describe('online rules', () => {
        it('accepts a request just before the cutoff and rejects it at and after the cutoff', async () => {
            const bread = await insertProduct();
            const justBefore = new Date(CUTOFF.getTime() - 1000);

            await expect(
                createReservation(buildInput([{ productId: bread.id, quantity: 1 }]), {
                    now: justBefore,
                }),
            ).resolves.toMatchObject({ status: 'confirmed' });

            for (const now of [CUTOFF, new Date(CUTOFF.getTime() + 60_000)]) {
                const late = createReservation(buildInput([{ productId: bread.id, quantity: 1 }]), {
                    now,
                });
                await expect(late).rejects.toBeInstanceOf(PickupDateUnavailableError);
                await expect(late).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
            }
        });

        it('rejects same-day pickup and closed days', async () => {
            const bread = await insertProduct();

            await expect(
                createReservation(buildInput([{ productId: bread.id, quantity: 1 }]), {
                    now: pragueTimeToInstant(PICKUP_DATE, 7),
                }),
            ).rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
            await expect(
                createReservation(
                    buildInput([{ productId: bread.id, quantity: 1 }], {
                        pickupDate: CLOSED_MONDAY,
                    }),
                    { now: pragueTimeToInstant('2099-05-09', 12) },
                ),
            ).rejects.toMatchObject({ code: 'BAKERY_CLOSED' });
        });

        it('enforces online quantity limits inside the service', async () => {
            const bread = await insertProduct({ defaultCapacity: 100 });
            const roll = await insertProduct({ defaultCapacity: 100 });
            const bun = await insertProduct({ defaultCapacity: 100 });

            await expect(
                createReservation(buildInput([{ productId: bread.id, quantity: 21 }]), {
                    now: BEFORE_CUTOFF,
                }),
            ).rejects.toMatchObject({
                code: 'PRODUCT_LIMIT_EXCEEDED',
                productId: bread.id,
                requested: 21,
            });
            await expect(
                createReservation(
                    buildInput([
                        { productId: bread.id, quantity: 20 },
                        { productId: roll.id, quantity: 20 },
                        { productId: bun.id, quantity: 11 },
                    ]),
                    { now: BEFORE_CUTOFF },
                ),
            ).rejects.toBeInstanceOf(OnlineQuantityLimitError);
            expect(await readReservations([bread.id, roll.id, bun.id])).toHaveLength(0);
        });
    });

    describe('admin rules', () => {
        it('has no online quantity limits', async () => {
            const bread = await insertProduct({ defaultCapacity: 40 });

            const result = await createReservation(
                buildInput([{ productId: bread.id, quantity: 25 }], { source: 'admin' }),
                { now: BEFORE_CUTOFF },
            );

            const [stored] = await getDb()
                .select({ source: reservations.source })
                .from(reservations)
                .where(eq(reservations.id, result.reservationId));
            expect(stored.source).toBe('admin');
        });

        it('rejects the pickup date at the cutoff, like an online reservation', async () => {
            const bread = await insertProduct();

            await expect(
                createReservation(
                    buildInput([{ productId: bread.id, quantity: 1 }], { source: 'admin' }),
                    { now: CUTOFF },
                ),
            ).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
            expect(await readReservations([bread.id])).toHaveLength(0);
        });

        it.each([
            ['on the pickup date', pragueTimeToInstant(PICKUP_DATE, 9)],
            ['after the pickup date', pragueTimeToInstant('2099-05-14', 8)],
        ])('rejects a booking %s', async (_label, now) => {
            const bread = await insertProduct();

            await expect(
                createReservation(
                    buildInput([{ productId: bread.id, quantity: 1 }], { source: 'admin' }),
                    { now },
                ),
            ).rejects.toMatchObject({ code: 'OUTSIDE_BOOKING_WINDOW' });
            expect(await readReservations([bread.id])).toHaveLength(0);
        });

        it('never bypasses capacity', async () => {
            const bread = await insertProduct({ defaultCapacity: 5, defaultWalkInQuantity: 2 });

            const attempt = createReservation(
                buildInput([{ productId: bread.id, quantity: 4 }], { source: 'admin' }),
                { now: BEFORE_CUTOFF },
            );
            await expect(attempt).rejects.toMatchObject({
                code: 'INSUFFICIENT_CAPACITY',
                shortages: [{ productId: bread.id, requested: 4, available: 3 }],
            });
            expect(await readReservations([bread.id])).toHaveLength(0);
        });
    });

    describe('idempotency', () => {
        it('replays the original confirmation for the same key and equivalent payload', async () => {
            const bread = await insertProduct({ price: 8900 });
            const roll = await insertProduct({ price: 600 });
            const input = buildInput([
                { productId: bread.id, quantity: 2 },
                { productId: roll.id, quantity: 1 },
            ]);
            const original = await createReservation(input, { now: BEFORE_CUTOFF });

            // Same request after a price change and a different formatting of the same payload.
            await getDb().update(products).set({ price: 9900 }).where(eq(products.id, bread.id));
            const replay = await createReservation(
                {
                    ...input,
                    customer: { name: ' Jane Doe ', phone: '+420 777 123 456' },
                    items: [
                        { productId: roll.id.toUpperCase(), quantity: 1 },
                        { productId: bread.id, quantity: 1 },
                        { productId: bread.id, quantity: 1 },
                    ],
                },
                { now: CUTOFF },
            );

            expect(replay).toEqual({ ...original, replayed: true });
            expect(await readReservations([bread.id, roll.id])).toHaveLength(1);
        });

        it('rejects the same key with a different payload or source', async () => {
            const bread = await insertProduct();
            const input = buildInput([{ productId: bread.id, quantity: 2 }]);
            await createReservation(input, { now: BEFORE_CUTOFF });

            await expect(
                createReservation(
                    { ...input, items: [{ productId: bread.id, quantity: 3 }] },
                    { now: BEFORE_CUTOFF },
                ),
            ).rejects.toBeInstanceOf(IdempotencyConflictError);
            await expect(
                createReservation({ ...input, source: 'admin' }, { now: BEFORE_CUTOFF }),
            ).rejects.toBeInstanceOf(IdempotencyConflictError);
            expect(await readReservations([bread.id])).toHaveLength(1);
        });

        it('fails loudly instead of replaying a dead link after the token secret changes', async () => {
            const bread = await insertProduct();
            const input = buildInput([{ productId: bread.id, quantity: 1 }]);
            await createReservation(input, { now: BEFORE_CUTOFF });

            const original = process.env.MANAGEMENT_TOKEN_SECRET;
            process.env.MANAGEMENT_TOKEN_SECRET = 'a-different-secret-that-is-at-least-32-chars';
            try {
                await expect(createReservation(input, { now: BEFORE_CUTOFF })).rejects.toThrow(
                    /does not match its stored hash/,
                );
            } finally {
                process.env.MANAGEMENT_TOKEN_SECRET = original;
            }
            expect(await readReservations([bread.id])).toHaveLength(1);
        });
    });
});
