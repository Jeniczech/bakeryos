import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type DbExecutor } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { dailyProductPlans } from '@/server/db/schema';
import { getRemainingAvailability } from '@/server/domain/availability';
import { getReservationCutoff } from '@/server/domain/reservation-rules';
import { assertPickupDateAvailable } from '../eligibility';
import { listOfferedProducts, type CatalogProduct } from './get-offered-products';

export type AvailableProduct = CatalogProduct & { remainingQuantity: number };

export type ProductCatalog = {
    pickupDate: string;
    orderingCutoff: Date;
    products: AvailableProduct[];
};

/**
 * Active products offered on the pickup date with their current price and remaining quantity,
 * whether or not the date can still be booked. Informational only: nothing is locked and no
 * daily plan is created; dates without a plan use the products' current defaults (TDD §5.3).
 * Runs queries concurrently, so pass the pool, not a transaction.
 */
export const listAvailableProducts = async (
    db: DbExecutor,
    pickupDate: string,
): Promise<AvailableProduct[]> => {
    const offered = await listOfferedProducts(db, pickupDate);
    const ids = offered.map((row) => row.id);
    if (ids.length === 0) {
        return [];
    }
    const [plans, committed] = await Promise.all([
        db
            .select({
                productId: dailyProductPlans.productId,
                capacity: dailyProductPlans.capacity,
                walkInQuantity: dailyProductPlans.walkInQuantity,
            })
            .from(dailyProductPlans)
            .where(
                and(
                    eq(dailyProductPlans.date, pickupDate),
                    inArray(dailyProductPlans.productId, ids),
                ),
            ),
        getCommittedQuantities(db, pickupDate, ids),
    ]);
    const plansByProduct = new Map(plans.map((plan) => [plan.productId, plan]));

    return offered.map((row) => {
        const plan = plansByProduct.get(row.id);
        const quantities = committed.get(row.id) ?? { activeReserved: 0, retainedCancelled: 0 };
        const remaining = getRemainingAvailability({
            capacity: plan?.capacity ?? row.defaultCapacity,
            walkInQuantity: plan?.walkInQuantity ?? row.defaultWalkInQuantity,
            ...quantities,
        });
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            imageUrl: row.imageUrl,
            price: row.price,
            remainingQuantity: Math.max(0, remaining),
        };
    });
};

/**
 * The catalog for a pickup date, rejecting dates that cannot be booked now. `createReservation`
 * rechecks everything transactionally. `now` is injectable for tests.
 */
export const getAvailableProducts = async (
    pickupDate: string,
    options: { now?: Date } = {},
): Promise<ProductCatalog> => {
    const db = getDb();
    await assertPickupDateAvailable(db, pickupDate, options.now ?? new Date());
    return {
        pickupDate,
        orderingCutoff: getReservationCutoff(pickupDate),
        products: await listAvailableProducts(db, pickupDate),
    };
};
