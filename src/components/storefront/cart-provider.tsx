'use client';

import { createContext, use, useMemo, useReducer, useState } from 'react';
import { cartReducer, type Cart, type CartAction } from '@/lib/cart/cart';
import type { CustomerDetails } from '@/lib/cart/customer-details';

type CartContextValue = {
    cart: Cart;
    dispatch: React.Dispatch<CartAction>;
    customer: CustomerDetails;
    setCustomer: React.Dispatch<React.SetStateAction<CustomerDetails>>;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Lives in the order layout, so the cart and the customer's details survive date switches,
 * which remount the page's cart. Kept in memory only: a full page reload empties it.
 */
export const CartProvider = ({ children }: { children: React.ReactNode }) => {
    const [cart, dispatch] = useReducer(cartReducer, []);
    const [customer, setCustomer] = useState<CustomerDetails>({ name: '', phone: '' });
    const value = useMemo(() => ({ cart, dispatch, customer, setCustomer }), [cart, customer]);
    return <CartContext value={value}>{children}</CartContext>;
};

export const useCart = (): CartContextValue => {
    const context = use(CartContext);
    if (!context) {
        throw new Error('useCart must be used within a CartProvider.');
    }
    return context;
};
