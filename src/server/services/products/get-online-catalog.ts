import type { PickupDateOption } from '@/server/domain/reservation-rules';
import { getPickupDates } from '../eligibility';
import { getAvailableProducts, type AvailableProduct } from './get-available-products';

export type OnlineCatalog = {
    dates: PickupDateOption[];
    /** Keyed by pickup date; only bookable dates have an entry. */
    productsByDate: Record<string, AvailableProduct[]>;
};

/**
 * The whole online booking window in one read, so the storefront can switch dates without a
 * server round trip. Every bookable date's catalog is loaded with the same `now`. Informational
 * like `getAvailableProducts`; `createReservation` rechecks everything transactionally.
 */
export const getOnlineCatalog = async (options: { now?: Date } = {}): Promise<OnlineCatalog> => {
    const now = options.now ?? new Date();
    const dates = await getPickupDates('online', now);
    const catalogs = await Promise.all(
        dates
            .filter((option) => option.unavailableReason === null)
            .map((option) => getAvailableProducts(option.date, { now })),
    );
    return {
        dates,
        productsByDate: Object.fromEntries(
            catalogs.map((catalog) => [catalog.pickupDate, catalog.products]),
        ),
    };
};
