import { connection } from 'next/server';
import { Suspense } from 'react';
import { PickupDatePicker } from '@/components/storefront/pickup-date-picker';
import { Notice } from '@/components/ui/notice';
import { getPickupDates } from '@/server/services/eligibility';

const PickupDates = async () => {
    // The window and cutoff depend on the current time, so the dates are never cached.
    await connection();
    const dates = await getPickupDates('online');
    return <PickupDatePicker dates={dates} />;
};

/**
 * Shared by `/` and `/den/[date]` and not re-rendered on a date switch, so the date list loads
 * once per visit while the page below swaps the catalog for each date.
 */
const OrderLayout = ({ children }: LayoutProps<'/'>) => (
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
        <Suspense fallback={<Notice>Načítáme dny vyzvednutí…</Notice>}>
            <PickupDates />
        </Suspense>
        {children}
    </div>
);

export default OrderLayout;
