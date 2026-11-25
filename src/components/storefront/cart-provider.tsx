'use client';

import { createContext, use, useMemo, useReducer } from 'react';
import { cartReducer, type Cart, type CartAction } from '@/lib/cart/cart';

type CartContextValue = { cart: Cart; dispatch: React.Dispatch<CartAction> };

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Lives in the order layout, so the cart survives date switches. Kept in memory only: a full
 * page reload empties it.
 */
export const CartProvider = ({ children }: { children: React.ReactNode }) => {
    const [cart, dispatch] = useReducer(cartReducer, []);
    const value = useMemo(() => ({ cart, dispatch }), [cart]);
    return <CartContext value={value}>{children}</CartContext>;
};

export const useCart = (): CartContextValue => {
    const context = use(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider.');
    }
    return context;
};
