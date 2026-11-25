import { describe, expect, it } from 'vitest';
import {
    cartReducer,
    getCartTotal,
    getCartUnits,
    getMaxQuantity,
    getQuantityLimit,
    type Cart,
    type CartProduct,
} from '@/lib/cart/cart';

const bread: CartProduct = {
    productId: 'bread',
    name: 'Chléb',
    unitPrice: 6500,
    availableQuantity: 10,
};
const roll: CartProduct = {
    productId: 'roll',
    name: 'Rohlík',
    unitPrice: 450,
    availableQuantity: 40,
};

const setQuantity = (cart: Cart, product: CartProduct, quantity: number): Cart =>
    cartReducer(cart, { type: 'setQuantity', product, quantity });

describe('cartReducer', () => {
    it('adds products in order and updates existing lines', () => {
        let cart = setQuantity([], bread, 1);
        cart = setQuantity(cart, roll, 3);
        cart = setQuantity(cart, bread, 2);
        expect(cart.map(({ productId, quantity }) => [productId, quantity])).toEqual([
            ['bread', 2],
            ['roll', 3],
        ]);
    });

    it('refreshes the product snapshot on update', () => {
        const cart = setQuantity(setQuantity([], bread, 1), { ...bread, unitPrice: 7000 }, 2);
        expect(cart[0]).toMatchObject({ unitPrice: 7000, quantity: 2 });
    });

    it('removes a line at zero or on remove', () => {
        const cart = setQuantity(setQuantity([], bread, 1), roll, 2);
        expect(setQuantity(cart, bread, 0).map((line) => line.productId)).toEqual(['roll']);
        expect(
            cartReducer(cart, { type: 'remove', productId: 'roll' }).map((line) => line.productId),
        ).toEqual(['bread']);
    });

    it('ignores non-integer quantities', () => {
        const cart = setQuantity([], bread, 1);
        expect(setQuantity(cart, bread, 2.5)).toBe(cart);
        expect(setQuantity(cart, bread, Number.NaN)).toBe(cart);
    });

    it('caps increases at the displayed availability', () => {
        expect(setQuantity([], bread, 11)[0].quantity).toBe(10);
        expect(setQuantity([], { ...bread, availableQuantity: 0 }, 1)).toEqual([]);
    });

    it('caps increases at 20 units per product', () => {
        expect(setQuantity([], roll, 25)[0].quantity).toBe(20);
    });

    it('caps increases at 50 units per reservation', () => {
        const products = ['a', 'b', 'c'].map((id) => ({ ...roll, productId: id }));
        let cart: Cart = [];
        for (const product of products) {
            cart = setQuantity(cart, product, 20);
        }
        expect(getCartUnits(cart)).toBe(50);
        expect(cart.map((line) => line.quantity)).toEqual([20, 20, 10]);
    });

    it('allows decreases while above a limit that has since dropped', () => {
        const cart = setQuantity([], bread, 8);
        const lessAvailable = { ...bread, availableQuantity: 3 };
        expect(setQuantity(cart, lessAvailable, 7)[0].quantity).toBe(7);
        expect(setQuantity(cart, lessAvailable, 9)[0].quantity).toBe(8);
    });
});

describe('quantity limits', () => {
    it('reports no limit while the quantity can grow', () => {
        const cart = setQuantity([], bread, 9);
        expect(getMaxQuantity(cart, bread)).toBe(10);
        expect(getQuantityLimit(cart, bread)).toBeNull();
    });

    it('reports which limit is reached', () => {
        expect(getQuantityLimit(setQuantity([], bread, 10), bread)).toBe('AVAILABILITY');
        expect(getQuantityLimit(setQuantity([], roll, 20), roll)).toBe('PRODUCT_LIMIT');
        const full = setQuantity(setQuantity([], { ...roll, productId: 'other' }, 20), roll, 20);
        const nearlyFull = setQuantity(full, { ...roll, productId: 'third' }, 10);
        expect(getQuantityLimit(nearlyFull, bread)).toBe('RESERVATION_LIMIT');
        expect(getMaxQuantity(nearlyFull, bread)).toBe(0);
    });
});

describe('cart totals', () => {
    it('sums units and haléře', () => {
        const cart = setQuantity(setQuantity([], bread, 2), roll, 3);
        expect(getCartUnits(cart)).toBe(5);
        expect(getCartTotal(cart)).toBe(2 * 6500 + 3 * 450);
        expect(getCartTotal([])).toBe(0);
    });
});
