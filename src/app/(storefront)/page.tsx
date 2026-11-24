import { connection } from 'next/server';
import { Suspense } from 'react';
import { Storefront, type StorefrontDate } from '@/components/storefront/storefront';
import { Notice } from '@/components/ui/notice';
import { formatLongDate, formatPragueDateTime, formatShortDate } from '@/lib/formatting/dates';
import { getOnlineCatalog } from '@/server/services/products/get-online-catalog';
import { getOnlineCutoff } from '@/server/domain/reservation-rules';

const StorefrontData = async () => {
    // Dates and availability depend on the current time and on reservations: never cached.
    await connection();
    const { dates, productsByDate } = await getOnlineCatalog();
    // Formatted here so the browser's Intl data cannot cause hydration mismatches.
    const storefrontDates: StorefrontDate[] = dates.map(({ date, unavailableReason }) => ({
        date,
        ...formatShortDate(date),
        longDate: formatLongDate(date),
        cutoff: formatPragueDateTime(getOnlineCutoff(date)),
        unavailableReason,
        products: productsByDate[date] ?? null,
    }));
    return <Storefront dates={storefrontDates} />;
};

const StorefrontPage = () => (
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
        <Suspense fallback={<Notice>Načítáme nabídku…</Notice>}>
            <StorefrontData />
        </Suspense>
    </div>
);

export default StorefrontPage;
