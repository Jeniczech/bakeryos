'use client';

import { getMaxQuantity, getQuantityLimit, type CartProduct } from '@/lib/cart/cart';
import { CART_CONTROL_ROW_CLASSES, LimitHint } from './limit-hint';
import { useCart } from './cart-provider';

const BUTTON_CLASSES =
    'flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white text-lg font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-300 disabled:hover:bg-white';

/** −/+ controls for a product already in the cart, with a hint once a limit is reached. */
export const QuantityStepper = ({
    product,
    quantity,
    showLimit = true,
}: {
    product: CartProduct;
    quantity: number;
    showLimit?: boolean;
}) => {
    const { cart, dispatch } = useCart();
    const limit = getQuantityLimit(cart, product);
    const setQuantity = (next: number) =>
        dispatch({ type: 'setQuantity', product, quantity: next });
    return (
        <div className={CART_CONTROL_ROW_CLASSES}>
            <button
                type="button"
                onClick={() => setQuantity(quantity - 1)}
                aria-label={`Odebrat 1 ks: ${product.name}`}
                className={BUTTON_CLASSES}
            >
                −
            </button>
            <output aria-live="polite" className="min-w-12 shrink-0 text-center font-semibold">
                {quantity} ks
            </output>
            <button
                type="button"
                onClick={() => setQuantity(quantity + 1)}
                disabled={quantity >= getMaxQuantity(cart, product)}
                aria-label={`Přidat 1 ks: ${product.name}`}
                className={BUTTON_CLASSES}
            >
                +
            </button>
            {showLimit && limit && <LimitHint limit={limit} />}
        </div>
    );
};
