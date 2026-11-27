import { cacheLife, cacheTag } from 'next/cache';
import Image from 'next/image';
import { Suspense } from 'react';
import { Notice } from '@/components/ui/notice';
import { formatLongDateAccusative, formatPragueDateTime } from '@/lib/formatting/dates';
import { getReservationCutoff } from '@/server/domain/reservation-rules';
import { getPickupDates } from '@/server/services/eligibility';
import { getOfferedProducts } from '@/server/services/products/get-offered-products';
import { ProductAvailability, ProductAvailabilitySkeleton } from './product-availability';

/**
 * The dates that can be booked online, cached so the catalog stays prefetchable. May lag the
 * clock by up to `expire` around the cutoff or midnight; the uncached `PickupDateStatus` and
 * the reservation transaction stay exact. Bounds the catalog cache to these dates.
 */
const getCachedBookableDates = async (): Promise<string[]> => {
    'use cache';
    // `expire` of 5 minutes is the shortest that still keeps the result in prefetches.
    cacheLife({ stale: 300, revalidate: 60, expire: 300 });
    cacheTag('catalog');
    const dates = await getPickupDates(new Date());
    return dates.filter((option) => option.unavailableReason === null).map(({ date }) => date);
};

/**
 * Product details change rarely, so they are cached per date and prefetched with the date
 * links. Admin product changes invalidate this tag (schedule editors are deferred). Prices are
 * not rendered from here: `ProductAvailability` shows the current one per request.
 */
const getCachedOfferedProducts = async (pickupDate: string) => {
    'use cache';
    cacheLife('minutes');
    cacheTag('catalog');
    return getOfferedProducts(pickupDate);
};

export const ProductCatalog = async ({ pickupDate }: { pickupDate: string }) => {
    // Dates that cannot be booked show no catalog: `PickupDateStatus` explains why.
    if (!(await getCachedBookableDates()).includes(pickupDate)) {
        return null;
    }
    const products = await getCachedOfferedProducts(pickupDate);
    if (products === null) {
        return null;
    }

    return (
        <section aria-labelledby="catalog-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h2 id="catalog-heading" className="text-lg font-semibold text-amber-950">
                    Nabídka pečiva na {formatLongDateAccusative(pickupDate)}
                </h2>
                <p className="text-sm text-stone-600">
                    Uzávěrka objednávek: {formatPragueDateTime(getReservationCutoff(pickupDate))}
                </p>
            </div>
            {products.length === 0 ? (
                <Notice>Na tento den není nic k rezervaci. Zkuste prosím jiný den.</Notice>
            ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                    {products.map((product) => (
                        <li
                            key={product.id}
                            className="flex flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm"
                        >
                            {product.imageUrl && (
                                <div className="relative aspect-[4/3] bg-amber-100">
                                    {/* Admin-entered URLs can point anywhere, so skip the optimizer's host allowlist. */}
                                    <Image
                                        src={product.imageUrl}
                                        alt=""
                                        fill
                                        unoptimized
                                        sizes="(min-width: 640px) 50vw, 100vw"
                                        className="object-cover"
                                    />
                                </div>
                            )}
                            <div className="flex flex-1 flex-col gap-1 p-4">
                                <h3 className="font-semibold text-amber-950">{product.name}</h3>
                                {product.description && (
                                    <p className="text-sm text-stone-600">{product.description}</p>
                                )}
                                <div className="mt-auto pt-2">
                                    {/* A dynamic hole in the cached, prefetched card. */}
                                    <Suspense fallback={<ProductAvailabilitySkeleton />}>
                                        <ProductAvailability
                                            pickupDate={pickupDate}
                                            productId={product.id}
                                        />
                                    </Suspense>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};
