import { connection } from 'next/server';
import { Suspense } from 'react';
import { CartProvider } from '@/components/storefront/cart-provider';
import { CartSummary } from '@/components/storefront/cart-summary';
import {
    PickupDatePicker,
    type PickupDateChoice,
} from '@/components/storefront/pickup-date-picker';
import { getOnlinePickupDates } from '@/components/storefront/pickup-date-status';
import { Notice } from '@/components/ui/notice';
import { formatShortDate } from '@/lib/formatting/dates';

const PickupDates = async () => {
    // The window and cutoff depend on the current time, so the dates are never cached.
    await connection();
    const dates = await getOnlinePickupDates();
    // Formatted here so the browser's Intl data cannot cause hydration mismatches.
    const choices: PickupDateChoice[] = dates.map(({ date, unavailableReason }) => ({
        date,
        ...formatShortDate(date),
        unavailableReason,
    }));
    return <PickupDatePicker dates={choices} />;
};

/**
 * Shared by `/` and `/den/[date]` and not re-rendered on a date switch, so the date list loads
 * once per visit while the page below swaps the catalog for each date, and the cart survives
 * date switches.
 */
const OrderLayout = ({ children }: LayoutProps<'/'>) => (
    <CartProvider>
        {/* On large screens the cart is a sticky sidebar; below that it follows the catalog. */}
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <div className="flex flex-col gap-8">
                <section className="flex flex-col gap-2">
                    <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                        Rezervujte si pečivo
                    </h1>
                    <p className="text-stone-600">
                        Vyberte den vyzvednutí, zvolte chléb a pečivo a zaplaťte až při převzetí.
                        Objednávky přijímáme do 18:00 předchozího dne.
                    </p>
                </section>
                <Suspense fallback={<Notice>Načítáme dny vyzvednutí…</Notice>}>
                    <PickupDates />
                </Suspense>
                {children}
            </div>
            <aside className="lg:sticky lg:top-6">
                <CartSummary />
            </aside>
        </div>
    </CartProvider>
);

export default OrderLayout;
