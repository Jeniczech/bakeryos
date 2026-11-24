import { randomUUID } from 'node:crypto';
import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, type Database } from '@/server/db/client';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    productWeekdays,
    products,
    rateLimits,
    reservationItems,
    reservations,
} from '@/server/db/schema';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type PgError = { code?: string; constraint?: string };

const findPgError = (error: unknown): PgError | null => {
    let current: unknown = error;
    while (current instanceof Error) {
        if ('code' in current && typeof current.code === 'string') {
            return current as PgError;
        }
        current = current.cause;
    }
    return null;
};

/** Runs the work in a transaction that is always rolled back; returns the database error, if any. */
const runAndRollBack = async (
    work: (tx: Transaction) => Promise<void>,
): Promise<PgError | null> => {
    try {
        await getDb().transaction(async (tx) => {
            await work(tx);
            tx.rollback();
        });
        return null;
    } catch (error) {
        if (error instanceof TransactionRollbackError) {
            return null;
        }
        const pgError = findPgError(error);
        if (!pgError) {
            throw error;
        }
        return pgError;
    }
};

const validProduct = { name: 'Test loaf', price: 8900, defaultCapacity: 10 };

const insertProduct = async (tx: Transaction) => {
    const [product] = await tx.insert(products).values(validProduct).returning();
    return product;
};

const validReservation = () => ({
    pickupDate: '2026-11-27',
    customerName: 'Jane Doe',
    customerPhone: '+420777123456',
    source: 'online' as const,
    managementTokenHash: randomUUID(),
    idempotencyKey: randomUUID(),
    requestHash: 'hash',
});

const insertReservation = async (tx: Transaction) => {
    const [reservation] = await tx.insert(reservations).values(validReservation()).returning();
    return reservation;
};

describe('schema constraints', () => {
    afterAll(async () => {
        await closeDb();
    });

    it('accepts valid rows and formats the reservation number', async () => {
        let reservationNumber = '';
        const error = await runAndRollBack(async (tx) => {
            const product = await insertProduct(tx);
            await tx.insert(dailyProductPlans).values({
                productId: product.id,
                date: '2026-11-27',
                capacity: 5,
                walkInQuantity: 5,
            });
            const reservation = await insertReservation(tx);
            reservationNumber = reservation.reservationNumber;
            await tx.insert(reservationItems).values({
                reservationId: reservation.id,
                productId: product.id,
                productNameSnapshot: product.name,
                unitPriceSnapshot: product.price,
                quantity: 1,
            });
        });
        expect(error).toBeNull();
        expect(reservationNumber).toMatch(/^BK-\d{6}$/);
    });

    describe('products', () => {
        it.each([
            ['products_price_nonnegative', { price: -1 }],
            ['products_default_capacity_nonnegative', { defaultCapacity: -1 }],
            ['products_default_walk_in_within_capacity', { defaultWalkInQuantity: 11 }],
            ['products_default_walk_in_within_capacity', { defaultWalkInQuantity: -1 }],
            ['products_name_not_blank', { name: '  ' }],
        ])('violates %s with %j', async (constraint, override) => {
            const error = await runAndRollBack(async (tx) => {
                await tx.insert(products).values({ ...validProduct, ...override });
            });
            expect(error?.constraint).toBe(constraint);
        });
    });

    describe('daily_product_plans', () => {
        it.each([
            ['daily_product_plans_capacity_nonnegative', { capacity: -1, walkInQuantity: 0 }],
            ['daily_product_plans_walk_in_within_capacity', { capacity: 5, walkInQuantity: 6 }],
            ['daily_product_plans_walk_in_within_capacity', { capacity: 5, walkInQuantity: -1 }],
        ])('violates %s with %j', async (constraint, quantities) => {
            const error = await runAndRollBack(async (tx) => {
                const product = await insertProduct(tx);
                await tx
                    .insert(dailyProductPlans)
                    .values({ productId: product.id, date: '2026-11-27', ...quantities });
            });
            expect(error?.constraint).toBe(constraint);
        });

        it('rejects a duplicate product/date plan', async () => {
            const error = await runAndRollBack(async (tx) => {
                const product = await insertProduct(tx);
                const plan = {
                    productId: product.id,
                    date: '2026-11-27',
                    capacity: 5,
                    walkInQuantity: 0,
                };
                await tx.insert(dailyProductPlans).values(plan);
                await tx.insert(dailyProductPlans).values(plan);
            });
            expect(error?.constraint).toBe('daily_product_plans_product_date_unique');
        });
    });

    describe('reservations', () => {
        it.each([
            ['reservations_status_valid', { status: 'shipped' as never }],
            ['reservations_source_valid', { source: 'partner' as never }],
            ['reservations_cancelled_at_matches_status', { status: 'cancelled' as const }],
            ['reservations_cancelled_at_matches_status', { cancelledAt: new Date() }],
            ['reservations_retain_only_when_cancelled', { retainForProduction: true }],
        ])('violates %s with %j', async (constraint, override) => {
            const error = await runAndRollBack(async (tx) => {
                await tx.insert(reservations).values({ ...validReservation(), ...override });
            });
            expect(error?.constraint).toBe(constraint);
        });

        it('accepts a retained late cancellation', async () => {
            const error = await runAndRollBack(async (tx) => {
                await tx.insert(reservations).values({
                    ...validReservation(),
                    status: 'cancelled',
                    cancelledAt: new Date(),
                    retainForProduction: true,
                });
            });
            expect(error).toBeNull();
        });

        it.each([
            ['reservations_idempotency_key_unique', 'idempotencyKey'],
            ['reservations_management_token_hash_unique', 'managementTokenHash'],
        ] as const)('violates %s on a duplicate %s', async (constraint, column) => {
            const error = await runAndRollBack(async (tx) => {
                const first = validReservation();
                await tx.insert(reservations).values(first);
                await tx
                    .insert(reservations)
                    .values({ ...validReservation(), [column]: first[column] });
            });
            expect(error?.constraint).toBe(constraint);
        });
    });

    describe('reservation_items', () => {
        it.each([
            ['reservation_items_quantity_positive', { quantity: 0 }],
            ['reservation_items_unit_price_nonnegative', { unitPriceSnapshot: -1 }],
        ])('violates %s with %j', async (constraint, override) => {
            const error = await runAndRollBack(async (tx) => {
                const product = await insertProduct(tx);
                const reservation = await insertReservation(tx);
                await tx.insert(reservationItems).values({
                    reservationId: reservation.id,
                    productId: product.id,
                    productNameSnapshot: product.name,
                    unitPriceSnapshot: product.price,
                    quantity: 1,
                    ...override,
                });
            });
            expect(error?.constraint).toBe(constraint);
        });

        it('rejects the same product twice in one reservation', async () => {
            const error = await runAndRollBack(async (tx) => {
                const product = await insertProduct(tx);
                const reservation = await insertReservation(tx);
                const item = {
                    reservationId: reservation.id,
                    productId: product.id,
                    productNameSnapshot: product.name,
                    unitPriceSnapshot: product.price,
                    quantity: 1,
                };
                await tx.insert(reservationItems).values(item);
                await tx.insert(reservationItems).values(item);
            });
            expect(error?.constraint).toBe('reservation_items_reservation_product_unique');
        });
    });

    describe('schedule and rate limits', () => {
        it('rejects weekdays outside 0–6', async () => {
            const openingDayError = await runAndRollBack(async (tx) => {
                await tx.insert(bakeryOpeningDays).values({ weekday: 7, isOpen: true });
            });
            expect(openingDayError?.constraint).toBe('bakery_opening_days_weekday_valid');

            const productWeekdayError = await runAndRollBack(async (tx) => {
                const product = await insertProduct(tx);
                await tx.insert(productWeekdays).values({ productId: product.id, weekday: -1 });
            });
            expect(productWeekdayError?.constraint).toBe('product_weekdays_weekday_valid');
        });

        it('rejects a negative rate-limit count', async () => {
            const error = await runAndRollBack(async (tx) => {
                await tx
                    .insert(rateLimits)
                    .values({ key: 'test', windowStart: new Date(), count: -1 });
            });
            expect(error?.constraint).toBe('rate_limits_count_nonnegative');
        });
    });
});
