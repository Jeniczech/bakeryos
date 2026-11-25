'use client';

import { useState } from 'react';
import type { ReservationConfirmation } from '@/lib/cart/checkout';
import { formatLongDate } from '@/lib/formatting/dates';
import { formatPrice } from '@/lib/formatting/money';

const SECONDARY_BUTTON_CLASSES =
    'rounded-lg border border-amber-300 bg-white px-4 py-2 font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700';

const CopyLinkButton = ({ url }: { url: string }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch {
            // Clipboard access can be denied; the link stays visible to copy by hand.
        }
    };
    return (
        <button type="button" onClick={copy} className={SECONDARY_BUTTON_CLASSES}>
            {copied ? 'Odkaz zkopírován' : 'Zkopírovat odkaz'}
        </button>
    );
};

/**
 * The reservation as the server confirmed it: its items and prices, not the cart's, so edits
 * made while the request was pending cannot make it wrong. Rendered on the client only, after
 * a submission, so formatting cannot cause hydration mismatches.
 */
export const ReservationConfirmationView = ({
    confirmation,
    onNewReservation,
}: {
    confirmation: ReservationConfirmation;
    onNewReservation: () => void;
}) => (
    <section aria-labelledby="confirmation-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
            <h1
                id="confirmation-heading"
                className="text-3xl font-semibold tracking-tight text-amber-950"
            >
                Rezervace je hotová
            </h1>
            <p className="text-stone-600">
                Číslo rezervace{' '}
                <strong className="font-semibold text-amber-950">
                    {confirmation.reservationNumber}
                </strong>
                , vyzvednutí {formatLongDate(confirmation.pickupDate)}. Zaplatíte až při vyzvednutí.
            </p>
        </div>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section
                aria-labelledby="confirmation-items-heading"
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
            >
                <h2
                    id="confirmation-items-heading"
                    className="text-lg font-semibold text-amber-950"
                >
                    Rezervované pečivo
                </h2>
                <ul className="flex flex-col divide-y divide-amber-100">
                    {confirmation.items.map((item) => (
                        <li
                            key={item.productId}
                            className="flex items-baseline justify-between gap-3 py-2"
                        >
                            <span>
                                <span className="font-medium text-amber-950">
                                    {item.productName}
                                </span>{' '}
                                <span className="text-sm text-stone-500">
                                    {item.quantity} × {formatPrice(item.unitPrice)}
                                </span>
                            </span>
                            <span className="font-semibold">
                                {formatPrice(item.unitPrice * item.quantity)}
                            </span>
                        </li>
                    ))}
                </ul>
                <div className="flex items-baseline justify-between border-t border-amber-200 pt-3">
                    <span className="font-semibold text-amber-950">Celkem</span>
                    <span className="text-lg font-semibold text-amber-950">
                        {formatPrice(confirmation.totalPrice)}
                    </span>
                </div>
            </section>
            <section
                aria-labelledby="confirmation-link-heading"
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
            >
                <h2 id="confirmation-link-heading" className="text-lg font-semibold text-amber-950">
                    Odkaz na rezervaci
                </h2>
                <p className="text-sm text-stone-600">
                    Uložte si tento odkaz. Přes něj rezervaci zobrazíte nebo zrušíte. Nikomu ho
                    neposílejte.
                </p>
                <a
                    href={confirmation.managementUrl}
                    className="break-all text-amber-900 underline underline-offset-2 hover:text-amber-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                    {confirmation.managementUrl}
                </a>
                <CopyLinkButton url={confirmation.managementUrl} />
            </section>
        </div>
        <div>
            <button type="button" onClick={onNewReservation} className={SECONDARY_BUTTON_CLASSES}>
                Vytvořit další rezervaci
            </button>
        </div>
    </section>
);
