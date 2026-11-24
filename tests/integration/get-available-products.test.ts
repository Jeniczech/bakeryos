import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
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
import { PickupDateUnavailableError } from '@/server/domain/errors';
import { getAvailableProducts } from '@/server/services/products/get-available-products';
import { createReservation } from '@/server/services/reservations/create-reservation';

// Far outside any real booking window; the clock is injected relative to this date.
const PICKUP_DATE = '2099-10-14'; // Wednesday
const WEDNESDAY = 3;
const MONDAY = 1;
const CLOSED_MONDAY = '2099-10-19';
const BEFORE_CUTOFF = pragueTimeToInstant('2099-10-13', 12);
const CUTOFF = pragueTimeToInstant('2099-10-13', 18);

const createdProductIds: string[] = [];

const insertProduct = async (
    overrides: Partial<typeof products.$inferInsert> = {},
    weekdays: number[] = [],
) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Catalog test loaf', price: 4200, defaultCapacity: 10, ...overrides })
        .returning();
    createdProductIds.push(product.id);
    if (weekdays.length > 0) {
        await getDb()
            .insert(productWeekdays)
            .values(weekdays.map((weekday) => ({ productId: product.id, weekday })));
    }
    return product;
};

/** Only this test's products; the catalog also lists seeded ones. */
const getCatalog = async (now = BEFORE_CUTOFF) => {
    const catalog = await getAvailableProducts(PICKUP_DATE, { now });
    return {
        ...catalog,
        products: catalog.products.filter((product) => createdProductIds.includes(product.id)),
    };
};

beforeAll(async () => {
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
    const reservationIds = (
        await getDb()
            .selectDistinct({ id: reservationItems.reservationId })
            .from(reservationItems)
            .where(inArray(reservationItems.productId, productIds))
    ).map((row) => row.id);
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

describe('getAvailableProducts', () => {
    it('lists products from their defaults without creating a daily plan', async () => {
        const product = await insertProduct({
            name: 'Rye',
            description: 'Dark rye',
            imageUrl: '/rye.jpg',
            price: 6500,
            defaultCapacity: 8,
            defaultWalkInQuantity: 3,
        });

        const catalog = await getCatalog();

        expect(catalog.pickupDate).toBe(PICKUP_DATE);
        expect(catalog.orderingCutoff).toEqual(CUTOFF);
        expect(catalog.products).toEqual([
            {
                id: product.id,
                name: 'Rye',
                description: 'Dark rye',
                imageUrl: '/rye.jpg',
                price: 6500,
                remainingQuantity: 5,
            },
        ]);
        const plans = await getDb()
            .select()
            .from(dailyProductPlans)
            .where(eq(dailyProductPlans.productId, product.id));
        expect(plans).toHaveLength(0);
    });

    it('uses an existing daily plan and subtracts committed reservations', async () => {
        const product = await insertProduct({ defaultCapacity: 10 });
        await getDb()
            .insert(dailyProductPlans)
            .values({ productId: product.id, date: PICKUP_DATE, capacity: 6, walkInQuantity: 1 });
        await createReservation(
            {
                idempotencyKey: randomUUID(),
                pickupDate: PICKUP_DATE,
                customer: { name: 'Jane Doe', phone: '+420777123456' },
                items: [{ productId: product.id, quantity: 2 }],
                source: 'online',
            },
            { now: BEFORE_CUTOFF },
        );

        const catalog = await getCatalog();

        expect(catalog.products).toMatchObject([{ id: product.id, remainingQuantity: 3 }]);
    });

    it('includes sold-out products with zero remaining', async () => {
        const product = await insertProduct({ defaultCapacity: 4, defaultWalkInQuantity: 4 });

        const catalog = await getCatalog();

        expect(catalog.products).toMatchObject([{ id: product.id, remainingQuantity: 0 }]);
    });

    it('leaves out inactive products and products not made on that weekday', async () => {
        const everyDay = await insertProduct({ name: 'A every day' });
        const wednesday = await insertProduct({ name: 'B Wednesday' }, [WEDNESDAY]);
        await insertProduct({ name: 'C inactive', active: false });
        await insertProduct({ name: 'D Monday' }, [MONDAY]);

        const catalog = await getCatalog();

        expect(catalog.products.map((product) => product.id)).toEqual([everyDay.id, wednesday.id]);
    });

    it.each([
        ['an invalid date', '2099-02-30', BEFORE_CUTOFF, 'INVALID_DATE'],
        ['a date after the ordering cutoff', PICKUP_DATE, CUTOFF, 'CUTOFF_PASSED'],
        ['a closed day', CLOSED_MONDAY, BEFORE_CUTOFF, 'BAKERY_CLOSED'],
        ['a date beyond the booking window', '2099-10-25', BEFORE_CUTOFF, 'OUTSIDE_BOOKING_WINDOW'],
    ])('rejects %s', async (_label, date, now, code) => {
        const attempt = getAvailableProducts(date, { now });

        await expect(attempt).rejects.toBeInstanceOf(PickupDateUnavailableError);
        await expect(attempt).rejects.toMatchObject({ code });
    });
});
