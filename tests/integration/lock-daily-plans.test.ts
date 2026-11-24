import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/server/db/client';
import {
    lockDailyPlans,
    materializeDailyPlans,
    sortProductIds,
} from '@/server/db/lock-daily-plans';
import { dailyProductPlans, products } from '@/server/db/schema';

// Far outside any booking window, so tests never collide with seeded or demo data.
const DATE = '2099-03-10';

const createdProductIds: string[] = [];

const insertProduct = async (defaults: {
    defaultCapacity: number;
    defaultWalkInQuantity: number;
}) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Materialization test loaf', price: 5000, ...defaults })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const readPlans = (productIds: string[]) =>
    getDb()
        .select()
        .from(dailyProductPlans)
        .where(
            and(inArray(dailyProductPlans.productId, productIds), eq(dailyProductPlans.date, DATE)),
        );

const materialize = (productIds: string[]) =>
    getDb().transaction((tx) => materializeDailyPlans(tx, DATE, productIds));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
    const ids = createdProductIds.splice(0);
    if (ids.length > 0) {
        await getDb().delete(dailyProductPlans).where(inArray(dailyProductPlans.productId, ids));
        await getDb().delete(products).where(inArray(products.id, ids));
    }
});

afterAll(async () => {
    await closeDb();
});

describe('sortProductIds', () => {
    it('deduplicates and sorts ascending', () => {
        const a = '0b6c7c55-0000-4000-8000-000000000000';
        const b = 'f1d2e3a4-0000-4000-8000-000000000000';
        expect(sortProductIds([b, a, b])).toEqual([a, b]);
    });
});

describe('materializeDailyPlans', () => {
    it('creates plans from the current product defaults', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const roll = await insertProduct({ defaultCapacity: 8, defaultWalkInQuantity: 0 });

        await materialize([roll.id, bread.id]);

        const plans = await readPlans([bread.id, roll.id]);
        expect(plans).toHaveLength(2);
        expect(plans.find((plan) => plan.productId === bread.id)).toMatchObject({
            date: DATE,
            capacity: 20,
            walkInQuantity: 5,
        });
        expect(plans.find((plan) => plan.productId === roll.id)).toMatchObject({
            date: DATE,
            capacity: 8,
            walkInQuantity: 0,
        });
    });

    it('keeps an existing plan when product defaults change later', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        await materialize([bread.id]);

        await getDb()
            .update(products)
            .set({ defaultCapacity: 50, defaultWalkInQuantity: 10 })
            .where(eq(products.id, bread.id));
        await materialize([bread.id]);

        const plans = await readPlans([bread.id]);
        expect(plans).toHaveLength(1);
        expect(plans[0]).toMatchObject({ capacity: 20, walkInQuantity: 5 });
    });

    it('fills in only missing plans and leaves existing ones unchanged', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const roll = await insertProduct({ defaultCapacity: 8, defaultWalkInQuantity: 0 });
        await getDb()
            .insert(dailyProductPlans)
            .values({ productId: bread.id, date: DATE, capacity: 3, walkInQuantity: 1 });

        await materialize([bread.id, roll.id]);

        const plans = await readPlans([bread.id, roll.id]);
        expect(plans).toHaveLength(2);
        expect(plans.find((plan) => plan.productId === bread.id)).toMatchObject({
            capacity: 3,
            walkInQuantity: 1,
        });
        expect(plans.find((plan) => plan.productId === roll.id)).toMatchObject({ capacity: 8 });
    });

    it('skips unknown product IDs and tolerates an empty list', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const unknownId = randomUUID();

        await materialize([]);
        await materialize([bread.id, unknownId]);

        expect(await readPlans([bread.id, unknownId])).toHaveLength(1);
    });

    it('creates exactly one plan per product under concurrent first writes', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const roll = await insertProduct({ defaultCapacity: 8, defaultWalkInQuantity: 0 });

        await Promise.all(
            Array.from({ length: 5 }, (_, index) =>
                materialize(index % 2 === 0 ? [bread.id, roll.id] : [roll.id, bread.id]),
            ),
        );

        const plans = await readPlans([bread.id, roll.id]);
        expect(plans).toHaveLength(2);
        expect(new Set(plans.map((plan) => plan.productId))).toEqual(new Set([bread.id, roll.id]));
    });
});

describe('lockDailyPlans', () => {
    it('materializes missing plans and returns them in ascending product-ID order', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        const roll = await insertProduct({ defaultCapacity: 8, defaultWalkInQuantity: 0 });
        const unknownId = randomUUID();

        const plans = await getDb().transaction((tx) =>
            lockDailyPlans(tx, DATE, [roll.id, unknownId, bread.id, roll.id]),
        );

        expect(plans.map((plan) => plan.productId)).toEqual(sortProductIds([bread.id, roll.id]));
        expect(await readPlans([bread.id, roll.id])).toHaveLength(2);
    });

    it('returns no plans for an empty list', async () => {
        expect(await getDb().transaction((tx) => lockDailyPlans(tx, DATE, []))).toEqual([]);
    });

    it('blocks a competing lock until commit and then returns the committed state', async () => {
        const bread = await insertProduct({ defaultCapacity: 20, defaultWalkInQuantity: 5 });
        // Commit the plan first so the waiter blocks on the row lock, not on the uncommitted insert.
        await materialize([bread.id]);
        let releaseHolder = () => {};
        const holderMayCommit = new Promise<void>((resolve) => (releaseHolder = resolve));
        let signalLocked = () => {};
        const holderLocked = new Promise<void>((resolve) => (signalLocked = resolve));

        const holder = getDb().transaction(async (tx) => {
            await lockDailyPlans(tx, DATE, [bread.id]);
            signalLocked();
            await holderMayCommit;
            await tx
                .update(dailyProductPlans)
                .set({ capacity: 30 })
                .where(
                    and(
                        eq(dailyProductPlans.productId, bread.id),
                        eq(dailyProductPlans.date, DATE),
                    ),
                );
        });

        try {
            await holderLocked;
            let waiterDone = false;
            const waiter = getDb()
                .transaction((tx) => lockDailyPlans(tx, DATE, [bread.id]))
                .finally(() => (waiterDone = true));

            await delay(200);
            expect(waiterDone).toBe(false);

            releaseHolder();
            await holder;
            const [plan] = await waiter;
            expect(plan.capacity).toBe(30);
        } finally {
            releaseHolder();
            await holder.catch(() => {});
        }
    });

    it('serializes overlapping writers in any input order without deadlocks', async () => {
        const created = await Promise.all(
            Array.from({ length: 3 }, () =>
                insertProduct({ defaultCapacity: 10, defaultWalkInQuantity: 0 }),
            ),
        );
        const ids = created.map((product) => product.id);
        const carts = [
            [ids[0], ids[1], ids[2]],
            [ids[2], ids[1], ids[0]],
            [ids[1], ids[0]],
            [ids[2], ids[0]],
            [ids[1], ids[2]],
            [ids[2], ids[1], ids[0]],
            [ids[0], ids[2], ids[1]],
            [ids[1], ids[0], ids[2]],
        ];

        await Promise.all(
            carts.map((cart) =>
                getDb().transaction(async (tx) => {
                    const plans = await lockDailyPlans(tx, DATE, cart);
                    await delay(10);
                    for (const plan of plans) {
                        await tx
                            .update(dailyProductPlans)
                            .set({ capacity: plan.capacity + 1 })
                            .where(eq(dailyProductPlans.id, plan.id));
                    }
                }),
            ),
        );

        const plans = await readPlans(ids);
        for (const id of ids) {
            const expected = 10 + carts.filter((cart) => cart.includes(id)).length;
            expect(plans.find((plan) => plan.productId === id)?.capacity).toBe(expected);
        }
    });
});
