'use client';

import { formatPrice } from '@/lib/formatting/money';
import { getCartTotal, getCartUnits } from '@/lib/cart/cart';
import { useCart } from './cart-provider';
import { QuantityStepper } from './quantity-stepper';

/**
 * The cart's lines and estimated total. Empty, it is hidden on small screens and shows an empty
 * state in the large-screen sidebar, so adding the first product does not shift the layout.
 */
export const CartSummary = () => {
    const { cart, dispatch } = useCart();
    if (cart.length === 0) {
        return (
            <section
                aria-labelledby="cart-heading"
                className="hidden flex-col gap-2 rounded-xl border border-amber-200 bg-white p-4 shadow-sm lg:flex"
            >
                <h2 id="cart-heading" className="text-lg font-semibold text-amber-950">
                    Košík
                </h2>
                <p className="text-sm text-stone-500">Košík je zatím prázdný.</p>
            </section>
        );
    }
    return (
        <section
            aria-labelledby="cart-heading"
            // The sticky sidebar stays within the viewport; long carts scroll their lines.
            className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-white p-4 shadow-sm lg:max-h-[calc(100dvh-3rem)]"
        >
            <h2 id="cart-heading" className="text-lg font-semibold text-amber-950">
                Košík
            </h2>
            <ul className="flex min-h-0 flex-col divide-y divide-amber-100 overflow-y-auto">
                {cart.map((line) => (
                    <li key={line.productId} className="flex flex-col gap-2 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col">
                                <span className="font-medium text-amber-950">{line.name}</span>
                                <span className="text-sm text-stone-500">
                                    {formatPrice(line.unitPrice)} / ks
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() =>
                                    dispatch({ type: 'remove', productId: line.productId })
                                }
                                aria-label={`Odebrat z košíku: ${line.name}`}
                                className="shrink-0 text-sm text-stone-500 underline-offset-2 hover:text-amber-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                            >
                                Odebrat
                            </button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            {/* The limit hint is shown on the product card. */}
                            <QuantityStepper
                                product={line}
                                quantity={line.quantity}
                                showLimit={false}
                            />
                            <span className="font-semibold">
                                {formatPrice(line.unitPrice * line.quantity)}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
            <div className="flex flex-col gap-1 border-t border-amber-200 pt-3">
                <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-amber-950">
                        Celkem ({getCartUnits(cart)} ks)
                    </span>
                    <span className="text-lg font-semibold text-amber-950">
                        {formatPrice(getCartTotal(cart))}
                    </span>
                </div>
                <p className="text-sm text-stone-500">
                    Konečnou cenu potvrdíme při odeslání rezervace. Platíte až při vyzvednutí.
                </p>
            </div>
        </section>
    );
};
