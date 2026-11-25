'use client';

import { useRouter } from 'next/navigation';
import { createContext, use, useCallback, useMemo, useRef, useState } from 'react';
import {
    describeSubmitFailure,
    parseRetryAfterMinutes,
    reservationConfirmationSchema,
    resolveSubmissionAttempt,
    type ReservationPayload,
    type SubmitFailureKind,
} from '@/lib/cart/checkout';
import { useClearCart } from './cart-provider';
import { readStoredAttempt, storeAttempt, storeConfirmation } from './checkout-storage';

export type SubmitFailure = {
    kind: SubmitFailureKind;
    /** The date it was sent for: the message only applies there. */
    pickupDate: string;
    retryAfterMinutes: number;
};

type CheckoutContextValue = {
    /** While true, the cart is locked, so what is reserved is what the customer sees. */
    submitting: boolean;
    failure: SubmitFailure | null;
    submit: (payload: ReservationPayload) => Promise<void>;
};

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

const readProblemCode = (body: unknown): string | null =>
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : null;

/**
 * Sends reservations from the order layout, so a submission and its double-submit guard
 * survive date switches. An unchanged retry reuses the stored idempotency key, even after a
 * reload, so a lost response cannot create a second reservation. On success the confirmation
 * is stored and shown at `/potvrzeni`.
 */
export const CheckoutProvider = ({ children }: { children: React.ReactNode }) => {
    const router = useRouter();
    const clearCart = useClearCart();
    // State updates are not synchronous, so a fast double click is stopped by a ref.
    const inFlight = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const [failure, setFailure] = useState<SubmitFailure | null>(null);

    const submit = useCallback(
        async (payload: ReservationPayload) => {
            if (inFlight.current) {
                return;
            }
            inFlight.current = true;
            setSubmitting(true);
            setFailure(null);
            const attempt = resolveSubmissionAttempt(readStoredAttempt(), payload, () =>
                crypto.randomUUID(),
            );
            storeAttempt(attempt);
            const fail = (code: string | null, retryAfter: string | null = null) => {
                const { kind, refreshCatalog } = describeSubmitFailure(code);
                setFailure({
                    kind,
                    pickupDate: payload.pickupDate,
                    retryAfterMinutes: parseRetryAfterMinutes(retryAfter),
                });
                if (refreshCatalog) {
                    router.refresh();
                }
            };
            try {
                const response = await fetch('/api/reservations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idempotencyKey: attempt.idempotencyKey, ...payload }),
                });
                const body: unknown = await response.json().catch(() => null);
                if (!response.ok) {
                    fail(readProblemCode(body), response.headers.get('Retry-After'));
                    return;
                }
                const confirmation = reservationConfirmationSchema.safeParse(body);
                if (!confirmation.success) {
                    // The reservation may exist; a retry with the same key replays it.
                    fail(null);
                    return;
                }
                storeAttempt(null);
                storeConfirmation(confirmation.data);
                // Next may keep this layout mounted for back navigation: leave it empty.
                clearCart();
                router.push('/potvrzeni');
            } catch {
                // A lost response may still have created the reservation; the retry reuses the key.
                fail(null);
            } finally {
                inFlight.current = false;
                setSubmitting(false);
            }
        },
        [router, clearCart],
    );

    const value = useMemo(
        (): CheckoutContextValue => ({ submitting, failure, submit }),
        [submitting, failure, submit],
    );
    return <CheckoutContext value={value}>{children}</CheckoutContext>;
};

export const useCheckout = (): CheckoutContextValue => {
    const context = use(CheckoutContext);
    if (!context) {
        throw new Error('useCheckout must be used within a CheckoutProvider.');
    }
    return context;
};
