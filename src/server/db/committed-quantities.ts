import { and, eq, inArray, sql } from 'drizzle-orm';
import { summarizeCommitments, type CommittedQuantities } from '@/server/domain/availability';
import type { DbExecutor } from './client';
import { reservationItems, reservations } from './schema';

/**
 * Sums reservation items per product for the pickup date, grouped by the fields that decide
 * whether an item is committed; the domain helper then applies that rule. Every requested
 * product gets an entry, zero when nothing is reserved. Inside a capacity-affecting write,
 * call this only after `lockDailyPlans()` so the totals include every committed competitor.
 */
export const getCommittedQuantities = async (
    db: DbExecutor,
    date: string,
    productIds: readonly string[],
): Promise<Map<string, CommittedQuantities>> => {
    const committed = new Map<string, CommittedQuantities>(
        productIds.map((productId) => [productId, { activeReserved: 0, retainedCancelled: 0 }]),
    );
    if (committed.size === 0) {
        return committed;
    }

    const groups = await db
        .select({
            productId: reservationItems.productId,
            status: reservations.status,
            retainForProduction: reservations.retainForProduction,
            quantity: sql<number>`sum(${reservationItems.quantity})::integer`,
        })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
        .where(
            and(
                eq(reservations.pickupDate, date),
                inArray(reservationItems.productId, [...committed.keys()]),
            ),
        )
        .groupBy(reservationItems.productId, reservations.status, reservations.retainForProduction);

    for (const productId of committed.keys()) {
        const productGroups = groups.filter((group) => group.productId === productId);
        committed.set(productId, summarizeCommitments(productGroups));
    }
    return committed;
};
