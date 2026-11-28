'use client';

import { Notice } from '@/components/ui/notice';
import { canSubmitCart, countFlaggedLines, reviewCart } from '@/lib/cart/cart';
import { buildReservationPayload, isSubmitFailureShown } from '@/lib/cart/checkout';
import { validateCustomerDetails } from '@/lib/cart/customer-details';
import { useCart } from './cart-provider';
import type { CartCatalog } from './cart-summary';
import { useCheckout, type SubmitFailure } from './checkout-provider';
import { useCustomer } from './customer-provider';

const FAILURE_MESSAGES: Record<SubmitFailure['kind'], (failure: SubmitFailure) => string> = {
    CAPACITY: () => 'Některé pečivo mezitím došlo. Zkontrolujte prosím košík a zkuste to znovu.',
    UNAVAILABLE: () => 'Některé pečivo už na tento den nelze rezervovat. Upravte prosím košík.',
    DATE_CLOSED: () => 'Na vybraný den už rezervace nepřijímáme. Vyberte prosím jiný den.',
    RATE_LIMITED: ({ retryAfterMinutes }) =>
        `Příliš mnoho pokusů o rezervaci. Zkuste to prosím znovu za ${retryAfterMinutes} min.`,
    RETRY: () => 'Rezervaci se nepodařilo odeslat. Zkuste to prosím znovu.',
};

/** Why the button is disabled, where the cart beside it does not already say so. */
const getDisabledHint = (catalog: CartCatalog, canSubmit: boolean): string | null => {
    switch (catalog.status) {
        case 'noDate':
            return 'Vyberte den vyzvednutí.';
        case 'closed':
            return 'Na vybraný den rezervovat nelze.';
        case 'failed':
            return 'Rezervaci teď nelze odeslat. Zkuste stránku obnovit.';
        case 'open':
            return canSubmit ? null : 'Nejprve upravte položky označené v košíku.';
        case 'loading':
            return null;
    }
};

/**
 * Sends the reservation. Disabled while the date's catalog is unknown or the cart has flagged
 * lines; invalid contact details are flagged on their fields on click instead, so the customer
 * learns what is missing.
 */
export const CheckoutButton = ({
    catalog,
    pickupDate,
}: {
    catalog: CartCatalog;
    /** `null` while no date is selected or the date is still loading. */
    pickupDate: string | null;
}) => {
    const { cart } = useCart();
    const { customer, markTouched } = useCustomer();
    const { submitting, failure, submit } = useCheckout();
    if (cart.length === 0) {
        return null;
    }
    const review = catalog.status === 'open' ? reviewCart(cart, catalog.products) : null;
    const canSubmit = pickupDate !== null && review !== null && canSubmitCart(review);
    const customerErrors = validateCustomerDetails(customer);
    const hasCustomerErrors = customerErrors.name !== null || customerErrors.phone !== null;

    const onClick = () => {
        if (!canSubmit || pickupDate === null) {
            return;
        }
        if (hasCustomerErrors) {
            markTouched('name');
            markTouched('phone');
            return;
        }
        void submit(buildReservationPayload(pickupDate, customer, cart));
    };

    const hint = getDisabledHint(catalog, canSubmit);
    const currentFailure =
        failure?.pickupDate === pickupDate &&
        isSubmitFailureShown(failure, {
            cart,
            flaggedLines: review ? countFlaggedLines(review.lines) : 0,
            dateClosed: catalog.status === 'closed',
        })
            ? failure
            : null;
    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                onClick={onClick}
                disabled={!canSubmit || submitting}
                className="rounded-lg bg-amber-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:hover:bg-stone-300"
            >
                {submitting ? 'Odesíláme…' : 'Odeslat rezervaci'}
            </button>
            {hint && <p className="text-sm text-stone-600">{hint}</p>}
            {currentFailure && (
                <Notice tone="warning">
                    {FAILURE_MESSAGES[currentFailure.kind](currentFailure)}
                </Notice>
            )}
        </div>
    );
};
