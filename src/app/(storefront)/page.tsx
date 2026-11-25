import { connection } from 'next/server';
import { Suspense } from 'react';
import {
    PickupDatePicker,
    type PickupDateChoice,
} from '@/components/storefront/pickup-date-picker';
import { PICKUP_DATE_MESSAGES } from '@/components/storefront/pickup-date-messages';
import { ProductCatalog } from '@/components/storefront/product-catalog';
import { SelectedDateContent, SelectedDateProvider } from '@/components/storefront/selected-date';
import { Notice } from '@/components/ui/notice';
import { formatLongDate, formatPragueDateTime, formatShortDate } from '@/lib/formatting/dates';
import { simulateDevLatency } from '@/server/dev-latency';
import { getOnlineCutoff } from '@/server/domain/reservation-rules';
import { getPickupDates } from '@/server/services/eligibility';
import { getAvailableProducts } from '@/server/services/products/get-available-products';

const loadingNotice = <Notice>Načítáme nabídku…</Notice>;

const DateCatalog = async ({
    selected,
    now,
}: {
    selected: PickupDateChoice | undefined;
    now: Date;
}) => {
    if (!selected) {
        return <Notice tone="warning">{PICKUP_DATE_MESSAGES.OUTSIDE_BOOKING_WINDOW}</Notice>;
    }
    if (selected.unavailableReason) {
        return <Notice tone="warning">{PICKUP_DATE_MESSAGES[selected.unavailableReason]}</Notice>;
    }
    const { products } = await getAvailableProducts(selected.date, { now });
    return (
        <ProductCatalog
            longDate={formatLongDate(selected.date)}
            cutoff={formatPragueDateTime(getOnlineCutoff(selected.date))}
            products={products}
        />
    );
};

const StorefrontData = async ({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) => {
    // Dates and availability depend on the current time and on reservations: never cached.
    await connection();
    await simulateDevLatency();
    const now = new Date();
    const [{ date }, pickupDates] = await Promise.all([
        searchParams,
        getPickupDates('online', now),
    ]);
    const selectedDate = typeof date === 'string' ? date : null;
    // Formatted here so the browser's Intl data cannot cause hydration mismatches.
    const dates: PickupDateChoice[] = pickupDates.map(({ date, unavailableReason }) => ({
        date,
        ...formatShortDate(date),
        unavailableReason,
    }));

    return (
        <SelectedDateProvider renderedDate={selectedDate}>
            <div className="flex flex-col gap-8">
                <PickupDatePicker dates={dates} />
                <SelectedDateContent pending={loadingNotice}>
                    {selectedDate === null ? (
                        <Notice>
                            Vyberte den vyzvednutí a ukážeme vám, co si můžete rezervovat.
                        </Notice>
                    ) : (
                        <Suspense fallback={loadingNotice}>
                            <DateCatalog
                                selected={dates.find((option) => option.date === selectedDate)}
                                now={now}
                            />
                        </Suspense>
                    )}
                </SelectedDateContent>
            </div>
        </SelectedDateProvider>
    );
};

const StorefrontPage = ({ searchParams }: PageProps<'/'>) => (
    <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                Rezervujte si pečivo
            </h1>
            <p className="text-stone-600">
                Vyberte den vyzvednutí, zvolte chléb a pečivo a zaplaťte až při převzetí. Objednávky
                přijímáme do 18:00 předchozího dne.
            </p>
        </section>
        <Suspense fallback={loadingNotice}>
            <StorefrontData searchParams={searchParams} />
        </Suspense>
    </div>
);

export default StorefrontPage;
