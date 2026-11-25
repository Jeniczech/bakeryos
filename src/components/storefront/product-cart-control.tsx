'use client';

import { getCartQuantity, getQuantityLimit, type CartProduct } from '@/lib/cart/cart';
import { useCartEditor } from './cart-provider';
import { useCheckout } from './checkout-provider';
import { CART_CONTROL_ROW_CLASSES, LimitHint } from './limit-hint';
import { QuantityStepper } from './quantity-stepper';

/** Adds a catalog product to the cart, then lets the customer adjust its quantity. */
export const ProductCartControl = ({
    pickupDate,
    product,
}: {
    pickupDate: string;
    product: CartProduct;
}) => {
    const { cart, dispatch } = useCartEditor(pickupDate);
    const { submitting } = useCheckout();
    const quantity = getCartQuantity(cart, product.productId);
    if (quantity > 0) {
        return (
            <QuantityStepper
                pickupDate={pickupDate}
                product={product}
                quantity={quantity}
                showLimit
                announce={false}
            />
        );
    }
    if (product.availableQuantity === 0) {
        return null;
    }
    // Only the reservation-wide limit can block the first unit of an available product.
    const limit = getQuantityLimit(cart, product);
    return (
        <div className={CART_CONTROL_ROW_CLASSES}>
            {limit ? (
                <LimitHint limit={limit} />
            ) : (
                <button
                    type="button"
                    onClick={() => dispatch({ type: 'setQuantity', product, quantity: 1 })}
                    disabled={submitting}
                    className="h-full flex-1 rounded-lg bg-amber-800 px-4 font-medium text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                    Přidat do košíku
                </button>
            )}
        </div>
    );
};
