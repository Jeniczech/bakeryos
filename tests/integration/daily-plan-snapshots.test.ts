import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import { InsufficientCapacityError } from '@/server/domain/errors';
import { getProduct } from '@/server/services/products/admin-products';
import { listAvailableProducts } from '@/server/services/products/get-available-products';
import { updateProduct } from '@/server/services/products/update-product';
import { createReservation } from '@/server/services/reservations/create-reservation';

// Far outside any real booking window; the clock is injected relative to these dates.
const PLANNED_DATE = '2099-10-14'; // Wednesday
const UNPLANNED_DATE = '2099-10-21'; // Wednesday
const WEDNESDAY = 3;
const BEFORE_CUTOFF = pragueTimeToInstant('2099-10-13', 12);

const createdProductIds: string[] = [];

const insertProduct = async (defaultCapacity: number, defaultWalkInQuantity: number) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Snapshot test loaf', price: 4500, defaultCapacity, defaultWalkInQuantity })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const reserve = (productId: string, quantity: number) =>
    createReservation(
        {
            idempotencyKey: randomUUID(),
            pickupDate: PLANNED_DATE,
            customer: { name: 'Jane Doe', phone: '+420777123456' },
            items: [{ productId, quantity }],
            source: 'admin',
        },
        { now: BEFORE_CUTOFF },
    );

const changeDefaults = async (
    productId: string,
    defaultCapacity: number,
    defaultWalkInQuantity: number,
) => {
    const product = await getProduct(productId);
    if (!product) {
        throw new Error('Test product is missing');
    }
    await updateProduct(
        productId,
        { ...product, defaultCapacity, defaultWalkInQuantity },
        product.version,
    );
};

const readPlan = async (productId: string, date: string) => {
    const [plan] = await getDb()
        .select({
            capacity: dailyProductPlans.capacity,
            walkInQuantity: dailyProductPlans.walkInQuantity,
        })
        .from(dailyProductPlans)
        .where(and(eq(dailyProductPlans.productId, productId), eq(dailyProductPlans.date, date)));
    return plan;
};

const readRemaining = async (productId: string, date: string) => {
    const catalog = await listAvailableProducts(getDb(), date);
    return catalog.find((product) => product.id === productId)?.remainingQuantity;
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

describe('first-write daily-plan snapshots', () => {
    it('keeps the capacity a reservation snapshotted when the defaults are raised', async () => {
        const bread = await insertProduct(5, 1);
        await reserve(bread.id, 2);
        expect(await readPlan(bread.id, PLANNED_DATE)).toEqual({ capacity: 5, walkInQuantity: 1 });

        await changeDefaults(bread.id, 20, 0);

        expect(await readPlan(bread.id, PLANNED_DATE)).toEqual({ capacity: 5, walkInQuantity: 1 });
        expect(await readPlan(bread.id, UNPLANNED_DATE)).toBeUndefined();
        expect(await readRemaining(bread.id, PLANNED_DATE)).toBe(2);
        expect(await readRemaining(bread.id, UNPLANNED_DATE)).toBe(20);
        await expect(reserve(bread.id, 3)).rejects.toBeInstanceOf(InsufficientCapacityError);
        await expect(reserve(bread.id, 3)).rejects.toMatchObject({
            shortages: [{ productId: bread.id, requested: 3, available: 2 }],
        });
        await expect(reserve(bread.id, 2)).resolves.toMatchObject({ status: 'confirmed' });
        expect(await readRemaining(bread.id, PLANNED_DATE)).toBe(0);
    });

    it('keeps a snapshotted plan that covers its reservations when the defaults are lowered', async () => {
        const bread = await insertProduct(10, 2);
        await reserve(bread.id, 6);

        await changeDefaults(bread.id, 3, 0);

        expect(await readPlan(bread.id, PLANNED_DATE)).toEqual({
            capacity: 10,
            walkInQuantity: 2,
        });
        expect(await readRemaining(bread.id, PLANNED_DATE)).toBe(2);
        expect(await readRemaining(bread.id, UNPLANNED_DATE)).toBe(3);
        await expect(reserve(bread.id, 2)).resolves.toMatchObject({ status: 'confirmed' });
    });
});
