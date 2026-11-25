'use client';

import { useRef, useState } from 'react';
import { Notice } from '@/components/ui/notice';
import { canSubmitCart, reviewCart } from '@/lib/cart/cart';
import { buildReservationPayload, type ReservationConfirmation } from '@/lib/cart/checkout';
import { validateCustomerDetails } from '@/lib/cart/customer-details';
import { useCartEditor } from './cart-provider';
import type { CartCatalog } from './cart-summary';
import { useCheckout } from './checkout-provider';
import { useCustomer } from './customer-provider';

type SubmitError = 'CUSTOMER' | 'FAILED';

const hasCustomerErrors = (errors: ReturnType<typeof validateCustomerDetails>): boolean =>
    errors.name !== null || errors.phone !== null;

/**
 * Sends the reservation. Disabled while the date's catalog is unknown or the cart has flagged
 * lines; invalid contact details are shown on click instead, so the customer learns what is
 * missing. A retry of an unchanged reservation reuses its idempotency key.
 */
export const CheckoutButton = ({
    catalog,
    pickupDate,
}: {
    catalog: CartCatalog;
    /** `null` while no date is selected or the date is still loading. */
    pickupDate: string | null;
}) => {
    const { cart, dispatch } = useCartEditor(pickupDate);
    const { customer, markTouched } = useCustomer();
    const { startAttempt, confirm } = useCheckout();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<SubmitError | null>(null);
    // State updates are not synchronous, so a fast double click is stopped by a ref.
    const inFlight = useRef(false);
    if (cart.length === 0) {
        return null;
    }
    const isOpen = catalog.status === 'open';
    const canSubmit =
        pickupDate !== null && isOpen && canSubmitCart(reviewCart(cart, catalog.products));
    const customerErrors = validateCustomerDetails(customer);

    const submit = async () => {
        if (inFlight.current || !canSubmit || pickupDate === null) {
            return;
        }
        if (hasCustomerErrors(customerErrors)) {
            markTouched('name');
            markTouched('phone');
            setError('CUSTOMER');
            return;
        }
        const payload = buildReservationPayload(pickupDate, customer, cart);
        const idempotencyKey = startAttempt(payload);
        inFlight.current = true;
        setPending(true);
        setError(null);
        try {
            const response = await fetch('/api/reservations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idempotencyKey, ...payload }),
            });
            if (!response.ok) {
                setError('FAILED');
                return;
            }
            const confirmation = (await response.json()) as ReservationConfirmation;
            dispatch({ type: 'clear' });
            confirm(confirmation);
        } catch {
            // A lost response may still have created the reservation; the retry reuses the key.
            setError('FAILED');
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    };

    const hint =
        catalog.status === 'noDate'
            ? 'Vyberte den vyzvednutí.'
            : isOpen && !canSubmit
              ? 'Nejprve upravte položky označené v košíku.'
              : null;
    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                onClick={submit}
                disabled={!canSubmit || pending}
                className="rounded-lg bg-amber-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:hover:bg-stone-300"
            >
                {pending ? 'Odesíláme…' : 'Odeslat rezervaci'}
            </button>
            {hint && <p className="text-sm text-stone-600">{hint}</p>}
            {error === 'CUSTOMER' && hasCustomerErrors(customerErrors) && (
                <Notice tone="warning">Doplňte prosím kontaktní údaje.</Notice>
            )}
            {error === 'FAILED' && (
                <Notice tone="warning">
                    Rezervaci se nepodařilo odeslat. Zkuste to prosím znovu.
                </Notice>
            )}
        </div>
    );
};
