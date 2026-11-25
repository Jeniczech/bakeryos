'use client';

import { useRouter } from 'next/navigation';
import { createContext, use, useMemo, useRef, useState } from 'react';
import {
    resolveSubmissionAttempt,
    type ReservationConfirmation,
    type ReservationPayload,
    type SubmissionAttempt,
} from '@/lib/cart/checkout';
import { ReservationConfirmationView } from './reservation-confirmation';

type CheckoutContextValue = {
    /** The idempotency key to send `payload` with; remembered for an unchanged retry. */
    startAttempt: (payload: ReservationPayload) => string;
    confirm: (confirmation: ReservationConfirmation) => void;
};

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

/**
 * In the order layout, so the last attempt survives date switches: a retry after a lost
 * response then reuses its key even if the customer looked at another date meanwhile. After a
 * reservation, shows its confirmation instead of the order page until the customer starts a
 * new one. Kept in memory only; the management link is what survives a reload.
 */
export const CheckoutProvider = ({ children }: { children: React.ReactNode }) => {
    const router = useRouter();
    // A ref: a retry must see the last attempt without waiting for a render.
    const lastAttempt = useRef<SubmissionAttempt | null>(null);
    const [confirmation, setConfirmation] = useState<ReservationConfirmation | null>(null);
    const value = useMemo(
        (): CheckoutContextValue => ({
            startAttempt: (payload) => {
                lastAttempt.current = resolveSubmissionAttempt(lastAttempt.current, payload, () =>
                    crypto.randomUUID(),
                );
                return lastAttempt.current.idempotencyKey;
            },
            confirm: (next) => {
                lastAttempt.current = null;
                setConfirmation(next);
                window.scrollTo({ top: 0 });
                // The catalog's remaining quantities now include this reservation.
                router.refresh();
            },
        }),
        [router],
    );
    return (
        <CheckoutContext value={value}>
            {confirmation ? (
                <ReservationConfirmationView
                    confirmation={confirmation}
                    onNewReservation={() => setConfirmation(null)}
                />
            ) : (
                children
            )}
        </CheckoutContext>
    );
};

export const useCheckout = (): CheckoutContextValue => {
    const context = use(CheckoutContext);
    if (!context) {
        throw new Error('useCheckout must be used within a CheckoutProvider.');
    }
    return context;
};
