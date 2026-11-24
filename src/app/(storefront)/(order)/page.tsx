import { Suspense } from 'react';
import { PickupDateStatus } from '@/components/storefront/pickup-date-status';
import { ProductCatalog } from '@/components/storefront/product-catalog';
import { Notice } from '@/components/ui/notice';

const SelectedDate = ({ date }: { date: string | undefined }) => {
    if (date === undefined) {
        return <Notice>Vyberte den vyzvednutí a ukážeme vám, co si můžete rezervovat.</Notice>;
    }
    return (
        <div className="flex flex-col gap-4">
            {/* Uncached and time-dependent; streams in after the cached catalog. */}
            <Suspense fallback={null}>
                <PickupDateStatus pickupDate={date} />
            </Suspense>
            <ProductCatalog pickupDate={date} />
        </div>
    );
};

const OrderPage = ({ searchParams }: PageProps<'/'>) => (
    <Suspense fallback={<Notice>Načítáme nabídku…</Notice>}>
        {searchParams.then(({ date }) => (
            <SelectedDate date={typeof date === 'string' ? date : undefined} />
        ))}
    </Suspense>
);

export default OrderPage;
