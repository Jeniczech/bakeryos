import { inArray, sql } from 'drizzle-orm';
import type { Transaction } from './client';
import { products } from './schema';

/** Deduplicated and sorted ascending; lowercase UUID strings sort like PostgreSQL `uuid` values. */
export const sortProductIds = (productIds: readonly string[]): string[] =>
    [...new Set(productIds)].sort();

/**
 * First-write snapshot: creates any missing plans for the date from the products' current
 * defaults. Existing plans are left untouched, and unknown product IDs are skipped, so
 * callers must validate products separately. Rows are inserted in ascending product-ID
 * order so concurrent materializations wait on each other instead of deadlocking.
 */
export const materializeDailyPlans = async (
    tx: Transaction,
    date: string,
    productIds: readonly string[],
): Promise<void> => {
    const ids = sortProductIds(productIds);
    if (ids.length === 0) {
        return;
    }
    await tx.execute(sql`
        insert into daily_product_plans (product_id, date, capacity, walk_in_quantity)
        select id, ${date}::date, default_capacity, default_walk_in_quantity
        from products
        where ${inArray(products.id, ids)}
        order by id
        on conflict (product_id, date) do nothing
    `);
};
