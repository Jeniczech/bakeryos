import { and, eq, inArray, sql } from 'drizzle-orm';
import {
    summarizeCommitments,
    type CommittedItem,
    type CommittedQuantities,
} from '@/server/domain/availability';
import type { DbExecutor } from './client';
import { normalizeProductIds } from './lock-daily-plans';
import { reservationItems, reservations } from './schema';

/**
 * Sums reservation items per product for the pickup date, grouped by the fields that decide
 * whether an item is committed; the domain helper then applies that rule. Every requested
 * product gets an entry keyed by its lowercase ID, zero when nothing is reserved. Inside a
 * capacity-affecting write, call this only after `lockDailyPlans()` so the totals include
 * every committed competitor.
 */
export const getCommittedQuantities = async (
    db: DbExecutor,
    date: string,
    productIds: readonly string[],
): Promise<Map<string, CommittedQuantities>> => {
    const ids = normalizeProductIds(productIds);
    if (ids.length === 0) {
        return new Map();
    }

    const groups = await db
        .select({
            productId: reservationItems.productId,
            status: reservations.status,
            retainForProduction: reservations.retainForProduction,
            // PostgreSQL sums integers as bigint, which node-postgres returns as a string.
            quantity: sql<number>`sum(${reservationItems.quantity})`.mapWith(Number),
        })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
        .where(and(eq(reservations.pickupDate, date), inArray(reservationItems.productId, ids)))
        .groupBy(reservationItems.productId, reservations.status, reservations.retainForProduction);

    const groupsByProduct = new Map<string, CommittedItem[]>(ids.map((id) => [id, []]));
    for (const group of groups) {
        groupsByProduct.get(group.productId)?.push(group);
    }
    return new Map(
        [...groupsByProduct].map(([productId, productGroups]) => [
            productId,
            summarizeCommitments(productGroups),
        ]),
    );
};
