import { describe, expect, it } from 'vitest';
import {
    cartReducer,
    getQuantityLimit,
    reviewCart,
    type Cart,
    type CartProduct,
    type LiveProduct,
} from '@/lib/cart/cart';

const bread: CartProduct = { productId: 'bread', name: 'Chléb', availableQuantity: 10 };
const roll: CartProduct = { productId: 'roll', name: 'Rohlík', availableQuantity: 40 };

const setQuantity = (cart: Cart, product: CartProduct, quantity: number): Cart =>
    cartReducer(cart, { type: 'setQuantity', product, quantity });

/** Adds units one at a time, as the stepper does, until an increase is refused. */
const fill = (cart: Cart, product: CartProduct): Cart => {
    for (;;) {
        const current = cart.find((line) => line.productId === product.productId)?.quantity ?? 0;
        const next = setQuantity(cart, product, current + 1);
        if (next === cart) {
            return cart;
        }
        cart = next;
    }
};

const quantities = (cart: Cart) => cart.map(({ productId, quantity }) => [productId, quantity]);

describe('cartReducer', () => {
    it('stores only product, name, and quantity, in the order added', () => {
        let cart = setQuantity([], bread, 1);
        cart = setQuantity(cart, roll, 3);
        cart = setQuantity(cart, { ...bread, name: 'Chléb kváskový' }, 2);
        expect(cart).toEqual([
            { productId: 'bread', name: 'Chléb kváskový', quantity: 2 },
            { productId: 'roll', name: 'Rohlík', quantity: 3 },
        ]);
    });

    it('removes a line at zero or on remove', () => {
        const cart = setQuantity(setQuantity([], bread, 1), roll, 2);
        expect(quantities(setQuantity(cart, bread, 0))).toEqual([['roll', 2]]);
        expect(quantities(cartReducer(cart, { type: 'remove', productId: 'roll' }))).toEqual([
            ['bread', 1],
        ]);
    });

    it('ignores invalid quantities', () => {
        const cart = setQuantity([], bread, 1);
        expect(setQuantity(cart, bread, 2.5)).toBe(cart);
        expect(setQuantity(cart, bread, Number.NaN)).toBe(cart);
        expect(setQuantity(cart, bread, -1)).toBe(cart);
    });

    it('refuses increases beyond the displayed availability', () => {
        expect(quantities(fill([], bread))).toEqual([['bread', 10]]);
        expect(setQuantity([], { ...bread, availableQuantity: 0 }, 1)).toEqual([]);
    });

    it('refuses increases beyond 20 units per product', () => {
        expect(quantities(fill([], roll))).toEqual([['roll', 20]]);
    });

    it('refuses increases beyond 50 units per reservation', () => {
        let cart: Cart = [];
        for (const productId of ['a', 'b', 'c']) {
            cart = fill(cart, { ...roll, productId });
        }
        expect(quantities(cart)).toEqual([
            ['a', 20],
            ['b', 20],
            ['c', 10],
        ]);
    });

    it('allows decreases while above a limit that has since dropped', () => {
        const cart = fill([], bread);
        const lessAvailable = { ...bread, availableQuantity: 3 };
        expect(quantities(setQuantity(cart, lessAvailable, 9))).toEqual([['bread', 9]]);
        expect(setQuantity(cart, lessAvailable, 11)).toBe(cart);
    });
});

describe('getQuantityLimit', () => {
    it('reports no limit while the quantity can grow', () => {
        expect(getQuantityLimit(setQuantity([], bread, 9), bread)).toBeNull();
    });

    it('reports which limit is reached', () => {
        expect(getQuantityLimit(fill([], bread), bread)).toBe('AVAILABILITY');
        expect(getQuantityLimit(fill([], roll), roll)).toBe('PRODUCT_LIMIT');
        let full: Cart = [];
        for (const productId of ['a', 'b', 'c']) {
            full = fill(full, { ...roll, productId });
        }
        expect(getQuantityLimit(full, bread)).toBe('RESERVATION_LIMIT');
    });
});

describe('reviewCart', () => {
    const live = (product: CartProduct, unitPrice: number): LiveProduct => ({
        ...product,
        unitPrice,
    });

    it('prices lines at the live price', () => {
        const cart = setQuantity(setQuantity([], bread, 2), roll, 3);
        const review = reviewCart(cart, [live(bread, 7000), live(roll, 450)]);
        expect(review.units).toBe(5);
        expect(review.total).toBe(2 * 7000 + 3 * 450);
        expect(review.lines.map((line) => line.issue)).toEqual([null, null]);
    });

    it('flags lines not offered on the date and leaves them out of the total', () => {
        const cart = setQuantity(setQuantity([], bread, 2), roll, 3);
        const review = reviewCart(cart, [live(roll, 450)]);
        expect(review.lines.map(({ issue, product }) => [issue, product?.productId])).toEqual([
            ['NOT_OFFERED', undefined],
            [null, 'roll'],
        ]);
        expect(review.units).toBe(3);
        expect(review.total).toBe(3 * 450);
    });

    it('flags lines above the current availability without changing them', () => {
        const cart = setQuantity([], bread, 5);
        const review = reviewCart(cart, [live({ ...bread, availableQuantity: 2 }, 6500)]);
        expect(review.lines[0]).toMatchObject({
            issue: 'EXCEEDS_AVAILABILITY',
            line: { quantity: 5 },
        });
        expect(review.total).toBe(5 * 6500);
    });
});
