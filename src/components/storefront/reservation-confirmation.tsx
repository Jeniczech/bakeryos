'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import type { ReservationConfirmation } from '@/lib/cart/checkout';
import { formatLongDateWithPreposition } from '@/lib/formatting/dates';
import { parseStoredConfirmation, readStoredConfirmationRaw } from './checkout-storage';
import { ReservationItems } from './reservation-items';

/** A replay reports the reservation's current status, which may have changed since. */
const HEADINGS: Record<ReservationConfirmation['status'], string> = {
    confirmed: 'Vaše rezervace je potvrzena!',
    cancelled: 'Tato rezervace je zrušená',
    picked_up: 'Tato rezervace už byla vyzvednuta',
    no_show: 'Tato rezervace nebyla vyzvednuta',
};

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

/** The reservation as the server confirmed it: its items and prices, not the cart's. */
const ConfirmationDetails = ({ confirmation }: { confirmation: ReservationConfirmation }) => (
    <section aria-labelledby="confirmation-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
            <h1
                id="confirmation-heading"
                className="text-3xl font-semibold tracking-tight text-amber-950"
            >
                {HEADINGS[confirmation.status]}
            </h1>
            <p className="text-stone-600">
                Číslo rezervace{' '}
                <strong className="font-semibold text-amber-950">
                    {confirmation.reservationNumber}
                </strong>
                , vyzvednutí {formatLongDateWithPreposition(confirmation.pickupDate)}.
                {confirmation.status === 'confirmed' && ' Zaplatíte až při vyzvednutí.'}
            </p>
        </div>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <ReservationItems items={confirmation.items} totalPrice={confirmation.totalPrice} />
            <section
                aria-labelledby="confirmation-link-heading"
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
            >
                <h2 id="confirmation-link-heading" className="text-lg font-semibold text-amber-950">
                    Odkaz na rezervaci
                </h2>
                <p className="text-sm text-stone-600">
                    Uložte si tento odkaz pro zobrazení nebo zrušení rezervace. Odkaz je soukromý, s
                    nikým ho nesdílejte.
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
            <Link href="/" className={`inline-block ${SECONDARY_BUTTON_CLASSES}`}>
                Vytvořit další rezervaci
            </Link>
        </div>
    </section>
);

const subscribe = () => () => {};

/**
 * The confirmation stored by the last successful submission in this tab, so it survives a
 * reload. Read on the client only: the server snapshot is `undefined`, so formatting cannot
 * cause hydration mismatches.
 */
export const StoredConfirmation = () => {
    const raw = useSyncExternalStore(subscribe, readStoredConfirmationRaw, () => undefined);
    if (raw === undefined) {
        return null;
    }
    const confirmation = parseStoredConfirmation(raw);
    if (!confirmation) {
        return (
            <div className="flex flex-col items-start gap-4">
                <Notice>
                    Potvrzení rezervace už není k dispozici. Rezervaci zobrazíte přes odkaz, který
                    jste si uložili.
                </Notice>
                <Link href="/" className={SECONDARY_BUTTON_CLASSES}>
                    Vytvořit rezervaci
                </Link>
            </div>
        );
    }
    return <ConfirmationDetails confirmation={confirmation} />;
};
