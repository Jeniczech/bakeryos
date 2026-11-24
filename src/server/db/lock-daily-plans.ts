import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from './client';
import { dailyProductPlans, products } from './schema';

export type DailyPlan = typeof dailyProductPlans.$inferSelect;

/**
 * Lowercased and deduplicated. PostgreSQL returns lowercase UUIDs, so results can be matched
 * to requests by ID. Lock and insert order come from `ORDER BY` in SQL, not from this list.
 */
export const normalizeProductIds = (productIds: readonly string[]): string[] => [
    ...new Set(productIds.map((productId) => productId.toLowerCase())),
];

/** A requested product has no plan, i.e. it does not exist; callers must validate products first. */
export class MissingDailyPlanError extends Error {
    constructor(readonly productIds: readonly string[]) {
        super(`No daily plan for product(s): ${productIds.join(', ')}`);
        this.name = 'MissingDailyPlanError';
    }
}

const insertMissingPlans = async (
    tx: Transaction,
    date: string,
    ids: readonly string[],
): Promise<void> => {
    await tx.execute(sql`
        insert into daily_product_plans (product_id, date, capacity, walk_in_quantity)
        select id, ${date}::date, default_capacity, default_walk_in_quantity
        from products
        where ${inArray(products.id, [...ids])}
        order by id
        on conflict (product_id, date) do nothing
    `);
};

/**
 * First-write snapshot: creates any missing plans for the date from the products' current
 * defaults. Existing plans are left untouched, and unknown product IDs are skipped, so
 * callers must validate products separately. Rows are inserted in ascending product-ID
 * order (`ORDER BY id`) so concurrent materializations wait on each other instead of
 * deadlocking.
 *
 * No eligibility check happens here (product activity, weekdays, closures): callers check
 * eligibility before locking and again after, and reject by throwing so the transaction
 * rolls back and no plan is left behind for an ineligible product/date.
 */
export const materializeDailyPlans = async (
    tx: Transaction,
    date: string,
    productIds: readonly string[],
): Promise<void> => {
    const ids = normalizeProductIds(productIds);
    if (ids.length > 0) {
        await insertMissingPlans(tx, date, ids);
    }
};

/**
 * The shared locking protocol for every write that affects a product/date's capacity or
 * committed quantity: materialize missing plans, then lock them with `FOR UPDATE` in
 * ascending product-ID order (`ORDER BY`; PostgreSQL locks rows as the sorted rows are
 * returned). Returns exactly one locked plan per distinct requested product, in that order,
 * and throws `MissingDailyPlanError` if any product is unknown, which rolls back the
 * caller's transaction. Committed quantities must be read only after this returns.
 * Eligibility is the caller's responsibility; see `materializeDailyPlans`.
 */
export const lockDailyPlans = async (
    tx: Transaction,
    date: string,
    productIds: readonly string[],
): Promise<DailyPlan[]> => {
    const ids = normalizeProductIds(productIds);
    if (ids.length === 0) {
        return [];
    }
    await insertMissingPlans(tx, date, ids);
    const plans = await tx
        .select()
        .from(dailyProductPlans)
        .where(and(eq(dailyProductPlans.date, date), inArray(dailyProductPlans.productId, ids)))
        .orderBy(asc(dailyProductPlans.productId))
        .for('update');
    if (plans.length !== ids.length) {
        const lockedIds = new Set(plans.map((plan) => plan.productId));
        throw new MissingDailyPlanError(ids.filter((productId) => !lockedIds.has(productId)));
    }
    return plans;
};
