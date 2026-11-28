'use client';

import { getQuantityLimit, type CartProduct } from '@/lib/cart/cart';
import { useCartEditor } from './cart-provider';
import { useCheckout } from './checkout-provider';
import { CART_CONTROL_ROW_CLASSES, LimitHint, OverAvailabilityHint } from './limit-hint';

const BUTTON_CLASSES =
    'flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white text-lg font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-300 disabled:hover:bg-white';

/**
 * −/+ controls for a product in the cart. `product` carries the availability currently
 * displayed for the selected date (0 when unknown). A product in the cart has a stepper on its
 * card and in the cart, so only the cart's one announces changes.
 */
export const QuantityStepper = ({
    pickupDate,
    product,
    quantity,
    showLimit,
    announce,
}: {
    pickupDate: string | null;
    product: CartProduct;
    quantity: number;
    showLimit: boolean;
    announce: boolean;
}) => {
    const { cart, dispatch } = useCartEditor(pickupDate);
    const { submitting } = useCheckout();
    const limit = getQuantityLimit(cart, product);
    const QuantityText = announce ? 'output' : 'span';
    const setQuantity = (next: number) =>
        dispatch({ type: 'setQuantity', product, quantity: next });
    return (
        <div className={CART_CONTROL_ROW_CLASSES}>
            <button
                type="button"
                onClick={() => setQuantity(quantity - 1)}
                disabled={submitting}
                aria-label={`Odebrat 1 ks: ${product.name}`}
                className={BUTTON_CLASSES}
            >
                −
            </button>
            {/* `<output>` is a live region; a `<span>` stays silent. */}
            <QuantityText className="min-w-12 shrink-0 text-center font-semibold">
                {quantity} ks
            </QuantityText>
            <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                disabled={limit !== null || submitting}
                aria-label={`Přidat 1 ks: ${product.name}`}
                className={BUTTON_CLASSES}
            >
                +
            </button>
            {showLimit &&
                (quantity > product.availableQuantity ? (
                    <OverAvailabilityHint availableQuantity={product.availableQuantity} />
                ) : (
                    limit && <LimitHint limit={limit} />
                ))}
        </div>
    );
};
