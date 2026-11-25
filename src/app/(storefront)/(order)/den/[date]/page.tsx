import { Suspense } from 'react';
import { CartColumns } from '@/components/storefront/cart-columns';
import { CartSummary } from '@/components/storefront/cart-summary';
import { LiveCartSummary } from '@/components/storefront/live-cart-summary';
import { PickupDateStatus } from '@/components/storefront/pickup-date-status';
import { ProductCatalog } from '@/components/storefront/product-catalog';
import { Notice } from '@/components/ui/notice';

type DateParams = PageProps<'/den/[date]'>['params'];

const DateStatus = async ({ params }: { params: DateParams }) => (
    <PickupDateStatus pickupDate={(await params).date} />
);

const DateCart = async ({ params }: { params: DateParams }) => (
    <LiveCartSummary pickupDate={(await params).date} />
);

const DateCatalog = async ({ params }: { params: DateParams }) => (
    <ProductCatalog pickupDate={(await params).date} />
);

/**
 * The date is a path segment rather than `?date=`: each date is then its own router segment,
 * so a switch mounts it fresh and renders the `<Link prefetch>` payload without waiting for
 * the server. A search-param change reuses the page segment and always waits.
 */
const PickupDatePage = ({ params }: PageProps<'/den/[date]'>) => (
    <CartColumns
        cart={
            // Prices and availability are per request, like the cards' live details.
            <Suspense fallback={<CartSummary catalog={{ status: 'loading' }} pickupDate={null} />}>
                <DateCart params={params} />
            </Suspense>
        }
    >
        {/* Uncached and time-dependent; streams in after the cached catalog. */}
        <Suspense fallback={null}>
            <DateStatus params={params} />
        </Suspense>
        <Suspense fallback={<Notice>Načítáme nabídku…</Notice>}>
            <DateCatalog params={params} />
        </Suspense>
    </CartColumns>
);

export default PickupDatePage;
