import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
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
import { PickupDateUnavailableError } from '@/server/domain/errors';
import {
    getAvailableProducts,
    listAvailableProducts,
} from '@/server/services/products/get-available-products';
import { getOfferedProducts } from '@/server/services/products/get-offered-products';
import { createReservation } from '@/server/services/reservations/create-reservation';
import { uniqueProductName } from '../support/unique-name';

// Far outside any real booking window; the clock is injected relative to this date.
const PICKUP_DATE = '2099-10-14'; // Wednesday
const WEDNESDAY = 3;
const MONDAY = 1;
// A closure, not a closed weekday: test files share the database, and others may open any weekday.
const CLOSED_DATE = '2099-10-18'; // Sunday, unused by other test files
const BEFORE_CUTOFF = pragueTimeToInstant('2099-10-13', 12);
const CUTOFF = pragueTimeToInstant('2099-10-13', 18);

const createdProductIds: string[] = [];

const insertProduct = async (
    overrides: Partial<typeof products.$inferInsert> = {},
    weekdays: number[] = [],
) => {
    const [product] = await getDb()
        .insert(products)
        .values({
            name: uniqueProductName('Catalog test loaf'),
            price: 4200,
            defaultCapacity: 10,
            ...overrides,
        })
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
    await getDb().insert(bakeryClosures).values({ date: CLOSED_DATE }).onConflictDoNothing();
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
    await getDb().delete(bakeryClosures).where(eq(bakeryClosures.date, CLOSED_DATE));
    await closeDb();
});

describe('getAvailableProducts', () => {
    it('lists products from their defaults without creating a daily plan', async () => {
        const product = await insertProduct({
            name: 'Catalog rye',
            description: 'Dark rye',
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
                name: 'Catalog rye',
                description: 'Dark rye',
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
        ['a closed day', CLOSED_DATE, BEFORE_CUTOFF, 'BAKERY_CLOSED'],
        ['a date beyond the booking window', '2099-10-25', BEFORE_CUTOFF, 'OUTSIDE_BOOKING_WINDOW'],
    ])('rejects %s', async (_label, date, now, code) => {
        const attempt = getAvailableProducts(date, { now });

        await expect(attempt).rejects.toBeInstanceOf(PickupDateUnavailableError);
        await expect(attempt).rejects.toMatchObject({ code });
    });
});

const insertCancelledReservation = async (
    productId: string,
    quantity: number,
    retainForProduction: boolean,
) => {
    const [reservation] = await getDb()
        .insert(reservations)
        .values({
            pickupDate: PICKUP_DATE,
            customerName: 'Jane Doe',
            customerPhone: '+420777123456',
            source: 'online',
            status: 'cancelled',
            retainForProduction,
            cancelledAt: new Date(),
            managementTokenHash: randomUUID(),
            idempotencyKey: randomUUID(),
            requestHash: 'hash',
        })
        .returning();
    await getDb().insert(reservationItems).values({
        reservationId: reservation.id,
        productId,
        productNameSnapshot: 'Catalog test loaf',
        unitPriceSnapshot: 4200,
        quantity,
    });
};

describe('listAvailableProducts', () => {
    /** Only this test's products, keyed by ID. */
    const listOwnProducts = async () =>
        new Map(
            (await listAvailableProducts(getDb(), PICKUP_DATE))
                .filter((product) => createdProductIds.includes(product.id))
                .map((product) => [product.id, product]),
        );

    it('does not depend on the clock, so it lists dates outside the booking window', async () => {
        // The real clock puts PICKUP_DATE far outside the window; getAvailableProducts rejects it.
        const product = await insertProduct({ price: 4200, defaultCapacity: 7 });

        const listed = await listOwnProducts();

        expect(listed.get(product.id)).toMatchObject({ price: 4200, remainingQuantity: 7 });
    });

    it('returns the current price right after it changes', async () => {
        const product = await insertProduct({ price: 4200 });
        await getDb().update(products).set({ price: 4900 }).where(eq(products.id, product.id));

        const listed = await listOwnProducts();

        expect(listed.get(product.id)?.price).toBe(4900);
    });

    it('counts late cancellations retained for production but not early ones', async () => {
        const product = await insertProduct({ defaultCapacity: 10 });
        await insertCancelledReservation(product.id, 3, true);
        await insertCancelledReservation(product.id, 4, false);

        const listed = await listOwnProducts();

        expect(listed.get(product.id)?.remainingQuantity).toBe(7);
    });

    it('omits withdrawn products so callers can tell them apart from sold-out ones', async () => {
        const soldOut = await insertProduct({ defaultCapacity: 2, defaultWalkInQuantity: 2 });
        const deactivated = await insertProduct();
        const unscheduled = await insertProduct({}, [WEDNESDAY]);
        await getDb()
            .update(products)
            .set({ active: false })
            .where(eq(products.id, deactivated.id));
        await getDb().delete(productWeekdays).where(eq(productWeekdays.productId, unscheduled.id));
        await getDb()
            .insert(productWeekdays)
            .values({ productId: unscheduled.id, weekday: MONDAY });

        const listed = await listOwnProducts();

        expect([...listed.keys()]).toEqual([soldOut.id]);
        expect(listed.get(soldOut.id)?.remainingQuantity).toBe(0);
    });
});

describe('getOfferedProducts', () => {
    it('lists offered products without availability, regardless of the cutoff', async () => {
        const wednesday = await insertProduct(
            { name: 'Catalog rye', description: 'Dark rye', price: 6500 },
            [WEDNESDAY],
        );
        await insertProduct({ name: 'Monday loaf' }, [MONDAY]);
        await insertProduct({ name: 'Inactive loaf', active: false });

        const offered = await getOfferedProducts(PICKUP_DATE);

        expect(offered?.filter((product) => createdProductIds.includes(product.id))).toEqual([
            {
                id: wednesday.id,
                name: 'Catalog rye',
                description: 'Dark rye',
                price: 6500,
            },
        ]);
    });

    it.each([
        ['an invalid date', '2099-02-30'],
        ['a closed day', CLOSED_DATE],
    ])('returns null for %s', async (_label, date) => {
        await insertProduct();

        expect(await getOfferedProducts(date)).toBeNull();
    });
});
