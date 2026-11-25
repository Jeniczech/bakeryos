'use client';

import { useRouter } from 'next/navigation';
import {
    createContext,
    startTransition,
    use,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    describeSubmitFailure,
    parseRetryAfterMinutes,
    reservationConfirmationSchema,
    resolveSubmissionAttempt,
    type ReservationPayload,
    type SubmitFailureKind,
} from '@/lib/cart/checkout';
import { readProblemCode } from '@/lib/http/problem-code';
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

/**
 * Sends reservations from the order layout, so a submission and its double-submit guard
 * survive date switches. An unchanged retry reuses the stored idempotency key, even after a
 * reload, so a lost response cannot create a second reservation. On success the confirmation
 * is stored and shown at `/potvrzeni`.
 */
export const CheckoutProvider = ({ children }: { children: React.ReactNode }) => {
    const router = useRouter();
    const clearCart = useClearCart();
    // State updates are not synchronous, so a fast double click is stopped by a ref. It is held
    // until `submitting` drops, so it also covers a success's pending navigation, when the
    // stored key is already cleared and a second submit would get a new one.
    const inFlight = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const [failure, setFailure] = useState<SubmitFailure | null>(null);

    useEffect(() => {
        if (!submitting) {
            inFlight.current = false;
        }
    }, [submitting]);

    const submit = useCallback(
        async (payload: ReservationPayload) => {
            if (inFlight.current) {
                return;
            }
            inFlight.current = true;
            setSubmitting(true);
            setFailure(null);
            const fail = (code: string | null, retryAfter: string | null = null) => {
                inFlight.current = false;
                setSubmitting(false);
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
                const attempt = await resolveSubmissionAttempt(readStoredAttempt(), payload, () =>
                    crypto.randomUUID(),
                );
                storeAttempt(attempt);
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
                // One transition with the navigation: the locked cart stays on screen until the
                // confirmation renders, instead of an empty, editable storefront in between.
                // Next may keep this layout mounted for back navigation, so it is left empty.
                startTransition(() => {
                    clearCart();
                    setSubmitting(false);
                    router.push('/potvrzeni');
                });
            } catch {
                // A lost response may still have created the reservation; the retry reuses the key.
                fail(null);
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
