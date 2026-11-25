import { Suspense } from 'react';
import { PickupDateStatus } from '@/components/storefront/pickup-date-status';
import { ProductCatalog } from '@/components/storefront/product-catalog';
import { Notice } from '@/components/ui/notice';

type DateParams = PageProps<'/den/[date]'>['params'];

const DateStatus = async ({ params }: { params: DateParams }) => (
    <PickupDateStatus pickupDate={(await params).date} />
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
    <div className="flex flex-col gap-4">
        {/* Uncached and time-dependent; streams in after the cached catalog. */}
        <Suspense fallback={null}>
            <DateStatus params={params} />
        </Suspense>
        <Suspense fallback={<Notice>Načítáme nabídku…</Notice>}>
            <DateCatalog params={params} />
        </Suspense>
    </div>
);

export default PickupDatePage;
