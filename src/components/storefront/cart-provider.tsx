'use client';

import { createContext, use, useMemo, useReducer } from 'react';
import {
    cartStateReducer,
    type CartAction,
    type CartState,
    type DatedCartAction,
} from '@/lib/cart/cart';

type CartContextValue = CartState & { dispatchDated: React.Dispatch<DatedCartAction> };

const CartContext = createContext<CartContextValue | null>(null);

const EMPTY_CART: CartState = { cart: [], editedForDate: null };

/**
 * Lives in the order layout, so the cart survives date switches. Kept in memory only: a full
 * page reload empties it.
 */
export const CartProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, dispatchDated] = useReducer(cartStateReducer, EMPTY_CART);
    const value = useMemo(() => ({ ...state, dispatchDated }), [state]);
    return <CartContext value={value}>{children}</CartContext>;
};

export const useCart = (): CartState => {
    const context = use(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider.');
    }
    return context;
};

/**
 * The cart with a `dispatch` that stamps each edit with the selected pickup date, or `null`
 * where no date is known. The date is passed in rather than read from the URL: `useParams()`
 * outside a `<Suspense>` boundary blocks prerendering.
 */
export const useCartEditor = (
    pickupDate: string | null,
): CartState & { dispatch: (action: CartAction) => void } => {
    const context = use(CartContext);
    if (!context) {
        throw new Error('useCartEditor must be used within a CartProvider.');
    }
    const { dispatchDated } = context;
    return { ...context, dispatch: (action) => dispatchDated({ ...action, pickupDate }) };
};
