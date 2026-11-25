import { connection } from 'next/server';
import { cache } from 'react';
import { PickupDateUnavailableError } from '@/server/domain/errors';
import { getAvailableProducts } from '@/server/services/products/get-available-products';

/**
 * Remaining quantity per product ID, loaded once per request for all catalog cards. `null`
 * when the date stopped being bookable after the cached catalog was built; the uncached
 * `PickupDateStatus` then explains why.
 */
const getRemainingQuantities = cache(
    async (pickupDate: string): Promise<Map<string, number> | null> => {
        try {
            const catalog = await getAvailableProducts(pickupDate);
            return new Map(
                catalog.products.map((product) => [product.id, product.remainingQuantity]),
            );
        } catch (error) {
            if (error instanceof PickupDateUnavailableError) {
                return null;
            }
            throw error;
        }
    },
);

export const RemainingQuantitySkeleton = () => (
    <span aria-hidden="true" className="block h-5 w-20 animate-pulse rounded bg-amber-100" />
);

/** Informational: never cached, and `createReservation` rechecks it transactionally. */
export const RemainingQuantity = async ({
    pickupDate,
    productId,
}: {
    pickupDate: string;
    productId: string;
}) => {
    // Reservations change availability at any time, so it is read per request.
    await connection();
    const quantities = await getRemainingQuantities(pickupDate);
    if (quantities === null) {
        return null;
    }
    // Missing when the product was deactivated or unscheduled after the catalog was cached.
    const remaining = quantities.get(productId) ?? 0;
    return remaining > 0 ? (
        <span className="text-sm text-emerald-800">Zbývá {remaining} ks</span>
    ) : (
        <span className="text-sm font-medium text-stone-500">Vyprodáno</span>
    );
};
