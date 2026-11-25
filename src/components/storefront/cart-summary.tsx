'use client';

import { useId } from 'react';
import { Notice } from '@/components/ui/notice';
import {
    countFlaggedLines,
    isCartFromOtherDate,
    reviewCart,
    type LiveProduct,
    type ReviewedCartLine,
} from '@/lib/cart/cart';
import { formatLongDate } from '@/lib/formatting/dates';
import { formatPrice } from '@/lib/formatting/money';
import { useCart, useCartEditor } from './cart-provider';
import { useCheckout } from './checkout-provider';
import { QuantityStepper } from './quantity-stepper';

/** The selected date's live catalog, as far as the cart needs it. */
export type CartCatalog =
    | { status: 'open'; products: LiveProduct[] }
    | { status: 'loading' | 'noDate' | 'closed' | 'failed' };

/** Shown instead of prices and a total until the selected date's live catalog is known. */
const CATALOG_STATUS_MESSAGES: Record<Exclude<CartCatalog['status'], 'open'>, string> = {
    loading: 'Ověřujeme ceny a dostupnost…',
    noDate: 'Ceny a dostupnost uvidíte po výběru dne vyzvednutí.',
    closed: 'Na vybraný den už rezervace nepřijímáme. Vyberte prosím jiný den.',
    failed: 'Ceny a dostupnost se nepodařilo načíst. Zkuste stránku obnovit.',
};

/**
 * Says the cart was checked again after a date switch, and warns while any line is flagged,
 * whatever the date, so changed prices and flagged lines do not go unnoticed.
 */
const CartReviewNotice = ({
    changedToDate,
    flaggedLines,
}: {
    changedToDate: string | null;
    flaggedLines: number;
}) => {
    if (changedToDate === null && flaggedLines === 0) {
        return null;
    }
    const messages = [
        changedToDate !== null &&
            `Košík jsme přepočítali pro nově vybraný den (${formatLongDate(changedToDate)}).`,
        flaggedLines > 0 &&
            'Některé položky na tento den nelze rezervovat v požadovaném množství. Upravte je prosím.',
    ].filter(Boolean);
    return <Notice tone={flaggedLines > 0 ? 'warning' : 'info'}>{messages.join(' ')}</Notice>;
};

const CartLineIssueMessage = ({ reviewed }: { reviewed: ReviewedCartLine }) => {
    if (reviewed.issue === 'NOT_OFFERED') {
        return <p className="text-sm text-orange-800">Na vybraný den nelze rezervovat.</p>;
    }
    if (reviewed.issue === 'EXCEEDS_AVAILABILITY' && reviewed.product) {
        return (
            <p className="text-sm text-orange-800">
                {reviewed.product.availableQuantity === 0
                    ? 'Na vybraný den je vyprodáno.'
                    : `Na vybraný den zbývá jen ${reviewed.product.availableQuantity} ks.`}
            </p>
        );
    }
    return null;
};

const CartLineItem = ({
    pickupDate,
    reviewed,
    showPrices,
}: {
    pickupDate: string | null;
    reviewed: ReviewedCartLine;
    showPrices: boolean;
}) => {
    const { dispatch } = useCartEditor(pickupDate);
    const { submitting } = useCheckout();
    const { line, product } = reviewed;
    const name = product?.name ?? line.name;
    return (
        <li className="flex flex-col gap-2 py-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-amber-950">{name}</span>
                    {showPrices && product && (
                        <span className="text-sm text-stone-500">
                            {formatPrice(product.unitPrice)} / ks
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => dispatch({ type: 'remove', productId: line.productId })}
                    disabled={submitting}
                    aria-label={`Odebrat z košíku: ${name}`}
                    className="shrink-0 text-sm text-stone-500 underline-offset-2 hover:text-amber-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:text-stone-300 disabled:no-underline"
                >
                    Odebrat
                </button>
            </div>
            <div className="flex items-center justify-between gap-3">
                {/* Without a live product nothing can be added; decreasing always works. */}
                <QuantityStepper
                    pickupDate={pickupDate}
                    product={{
                        productId: line.productId,
                        name,
                        availableQuantity: product?.availableQuantity ?? 0,
                    }}
                    quantity={line.quantity}
                    showLimit={false}
                    announce
                />
                {showPrices && product && (
                    <span className="font-semibold">
                        {formatPrice(product.unitPrice * line.quantity)}
                    </span>
                )}
            </div>
            {showPrices && <CartLineIssueMessage reviewed={reviewed} />}
        </li>
    );
};

/**
 * The cart checked against the selected date's live catalog: current prices, flagged lines,
 * and a total of the lines that date offers. Empty, it is hidden on small screens and shows an
 * empty state in the large-screen sidebar, so adding the first product does not shift the
 * layout.
 */
export const CartSummary = ({
    catalog,
    pickupDate,
}: {
    catalog: CartCatalog;
    /** `null` while no date is selected or the date is still loading. */
    pickupDate: string | null;
}) => {
    const cartState = useCart();
    const { cart } = cartState;
    // Unique per instance: Next keeps the previous page's cart mounted, hidden, for back navigation.
    const headingId = useId();
    if (cart.length === 0) {
        return (
            <section
                aria-labelledby={headingId}
                className="hidden flex-col gap-2 rounded-xl border border-amber-200 bg-white p-4 shadow-sm lg:flex"
            >
                <h2 id={headingId} className="text-lg font-semibold text-amber-950">
                    Košík
                </h2>
                <p className="text-sm text-stone-500">Košík je zatím prázdný.</p>
            </section>
        );
    }
    const isOpen = catalog.status === 'open';
    const review = reviewCart(cart, isOpen ? catalog.products : []);
    // The cart is empty when rendered on the server, so formatting the date cannot mismatch.
    const changedToDate =
        pickupDate !== null && isCartFromOtherDate(cartState, pickupDate) ? pickupDate : null;
    return (
        <section
            aria-labelledby={headingId}
            className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
        >
            <h2 id={headingId} className="text-lg font-semibold text-amber-950">
                Košík
            </h2>
            {isOpen && (
                <CartReviewNotice
                    changedToDate={changedToDate}
                    flaggedLines={countFlaggedLines(review.lines)}
                />
            )}
            <ul className="flex flex-col divide-y divide-amber-100">
                {review.lines.map((reviewed) => (
                    <CartLineItem
                        key={reviewed.line.productId}
                        pickupDate={pickupDate}
                        reviewed={reviewed}
                        showPrices={isOpen}
                    />
                ))}
            </ul>
            <div className="flex flex-col gap-1 border-t border-amber-200 pt-3">
                {isOpen ? (
                    <>
                        <div className="flex items-baseline justify-between">
                            <span className="font-semibold text-amber-950">
                                Celkem ({review.units} ks)
                            </span>
                            <span className="text-lg font-semibold text-amber-950">
                                {formatPrice(review.total)}
                            </span>
                        </div>
                        <p className="text-sm text-stone-500">Platíte až při vyzvednutí.</p>
                    </>
                ) : (
                    <p className="text-sm text-stone-600">
                        {CATALOG_STATUS_MESSAGES[catalog.status]}
                    </p>
                )}
            </div>
        </section>
    );
};
