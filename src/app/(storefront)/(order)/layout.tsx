import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CartProvider } from '@/components/storefront/cart-provider';
import { CheckoutProvider } from '@/components/storefront/checkout-provider';
import { CustomerProvider } from '@/components/storefront/customer-provider';
import {
    PickupDatePicker,
    type PickupDateChoice,
} from '@/components/storefront/pickup-date-picker';
import { getOnlinePickupDates } from '@/components/storefront/pickup-date-status';
import { Notice } from '@/components/ui/notice';
import { formatShortDate } from '@/lib/formatting/dates';
import type { PickupDateOption } from '@/server/domain/reservation-rules';

const PickupDates = async () => {
    // The window and cutoff depend on the current time, so the dates are never cached.
    await connection();
    let dates: PickupDateOption[];
    try {
        dates = await getOnlinePickupDates();
    } catch (error) {
        unstable_rethrow(error);
        // Handled here: the storefront error boundary would unmount the cart and contact details.
        console.error('Failed to load pickup dates', error);
        return (
            <Notice tone="warning">
                Dny vyzvednutí se nepodařilo načíst. Zkuste prosím stránku za chvíli obnovit.
            </Notice>
        );
    }
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
 * date switches. After a reservation, `CheckoutProvider` shows its confirmation instead.
 */
const OrderLayout = ({ children }: LayoutProps<'/'>) => (
    <CartProvider>
        <CustomerProvider>
            <CheckoutProvider>
                <div className="flex flex-col gap-8">
                    <section className="flex flex-col gap-2">
                        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                            Rezervujte si pečivo
                        </h1>
                        <p className="text-stone-600">
                            Vyberte den vyzvednutí, zvolte chléb a pečivo a zaplaťte až při
                            převzetí. Objednávky přijímáme do 18:00 předchozího dne.
                        </p>
                    </section>
                    <Suspense fallback={<Notice>Načítáme dny vyzvednutí…</Notice>}>
                        <PickupDates />
                    </Suspense>
                    {/* Each page renders the cart beside its content, checked against its date. */}
                    {children}
                </div>
            </CheckoutProvider>
        </CustomerProvider>
    </CartProvider>
);

export default OrderLayout;
