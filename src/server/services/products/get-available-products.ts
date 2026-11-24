import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { dailyProductPlans } from '@/server/db/schema';
import { getRemainingAvailability } from '@/server/domain/availability';
import { getOnlineCutoff } from '@/server/domain/reservation-rules';
import { assertPickupDateAvailable } from '../eligibility';
import { listOfferedProducts, type CatalogProduct } from './get-offered-products';

export type AvailableProduct = CatalogProduct & { remainingQuantity: number };

export type ProductCatalog = {
    pickupDate: string;
    orderingCutoff: Date;
    products: AvailableProduct[];
};

/**
 * The online catalog for a pickup date: active products offered that weekday, with their
 * remaining quantity. Informational only, so nothing is locked and no daily plan is
 * created; dates without a plan use the products' current defaults (TDD §5.3).
 * `createReservation` rechecks everything transactionally. `now` is injectable for tests.
 */
export const getAvailableProducts = async (
    pickupDate: string,
    options: { now?: Date } = {},
): Promise<ProductCatalog> => {
    const db = getDb();
    await assertPickupDateAvailable(db, pickupDate, 'online', options.now ?? new Date());

    const offered = await listOfferedProducts(db, pickupDate);
    const ids = offered.map((row) => row.id);
    const plans =
        ids.length > 0
            ? await db
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
                  )
            : [];
    const plansByProduct = new Map(plans.map((plan) => [plan.productId, plan]));
    const committed = await getCommittedQuantities(db, pickupDate, ids);

    return {
        pickupDate,
        orderingCutoff: getOnlineCutoff(pickupDate),
        products: offered.map((row) => {
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
        }),
    };
};
