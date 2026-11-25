import { cache } from 'react';
import { getDb } from '@/server/db/client';
import {
    listAvailableProducts,
    type AvailableProduct,
} from '@/server/services/products/get-available-products';
import { getOnlinePickupDates } from './pickup-date-status';

export type LiveCatalog =
    | { status: 'open'; products: Map<string, AvailableProduct> }
    | { status: 'closed' }
    | { status: 'failed' };

/**
 * Current prices and remaining quantities for a pickup date, loaded once per request and
 * shared by the catalog cards and the cart. The bookability check shares `PickupDateStatus`'s
 * per-request date list. A failure only blanks the live details instead of replacing the page
 * with an error. Callers must `await connection()` first.
 */
export const getLiveCatalog = cache(async (pickupDate: string): Promise<LiveCatalog> => {
    try {
        const dates = await getOnlinePickupDates();
        const isBookable = dates.some(
            (option) => option.date === pickupDate && option.unavailableReason === null,
        );
        if (!isBookable) {
            return { status: 'closed' };
        }
        const products = await listAvailableProducts(getDb(), pickupDate);
        return {
            status: 'open',
            products: new Map(products.map((product) => [product.id, product])),
        };
    } catch (error) {
        console.error('Failed to load catalog availability', error);
        return { status: 'failed' };
    }
});
