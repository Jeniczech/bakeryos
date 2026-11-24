'use client';

import { useSearchParams } from 'next/navigation';
import { Notice } from '@/components/ui/notice';
import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';
import type { AvailableProduct } from '@/server/services/products/get-available-products';
import { PickupDatePicker } from './pickup-date-picker';
import { PICKUP_DATE_MESSAGES } from './pickup-date-messages';
import { ProductCatalog } from './product-catalog';

export type StorefrontDate = {
    date: string;
    weekday: string;
    dayMonth: string;
    longDate: string;
    cutoff: string;
    unavailableReason: PickupDateRejectionReason | null;
    /** `null` when the date cannot be booked. */
    products: AvailableProduct[] | null;
};

/**
 * Every bookable date's catalog arrives with the page, so switching dates only updates the URL
 * (`pushState`, which `useSearchParams` follows) and never waits for the server.
 */
export const Storefront = ({ dates }: { dates: readonly StorefrontDate[] }) => {
    const selectedDate = useSearchParams().get('date');
    const selected = dates.find((option) => option.date === selectedDate);

    const selectDate = (date: string) => {
        const params = new URLSearchParams(window.location.search);
        params.set('date', date);
        window.history.pushState(null, '', `?${params.toString()}`);
    };

    let content: React.ReactNode;
    if (selectedDate === null) {
        content = <Notice>Vyberte den vyzvednutí a ukážeme vám, co si můžete rezervovat.</Notice>;
    } else if (!selected) {
        content = <Notice tone="warning">{PICKUP_DATE_MESSAGES.OUTSIDE_BOOKING_WINDOW}</Notice>;
    } else if (selected.unavailableReason !== null || selected.products === null) {
        content = (
            <Notice tone="warning">
                {PICKUP_DATE_MESSAGES[selected.unavailableReason ?? 'OUTSIDE_BOOKING_WINDOW']}
            </Notice>
        );
    } else {
        content = (
            <ProductCatalog
                longDate={selected.longDate}
                cutoff={selected.cutoff}
                products={selected.products}
            />
        );
    }

    return (
        <div className="flex flex-col gap-8">
            <PickupDatePicker
                dates={dates}
                selectedDate={selected?.date ?? null}
                onSelect={selectDate}
            />
            {content}
        </div>
    );
};
