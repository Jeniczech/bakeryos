import {
    ONLINE_MAX_UNITS_PER_PRODUCT,
    ONLINE_MAX_UNITS_PER_RESERVATION,
} from '@/lib/validation/reservation';

/** A product as last displayed in the catalog; price in haléře. */
export type CartProduct = {
    productId: string;
    name: string;
    unitPrice: number;
    availableQuantity: number;
};

export type CartLine = CartProduct & { quantity: number };

/** Lines in the order they were added. Display-only: the server prices and rechecks everything. */
export type Cart = readonly CartLine[];

export type CartAction =
    | { type: 'setQuantity'; product: CartProduct; quantity: number }
    | { type: 'remove'; productId: string };

export type QuantityLimit = 'AVAILABILITY' | 'PRODUCT_LIMIT' | 'RESERVATION_LIMIT';

export const getCartQuantity = (cart: Cart, productId: string): number =>
    cart.find((line) => line.productId === productId)?.quantity ?? 0;

export const getCartUnits = (cart: Cart): number =>
    cart.reduce((sum, line) => sum + line.quantity, 0);

export const getCartTotal = (cart: Cart): number =>
    cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

/** The binding limit and the most units of the product the cart may hold under it. */
const getQuantityBound = (
    cart: Cart,
    product: CartProduct,
): { limit: QuantityLimit; max: number } => {
    const unitsOfOtherProducts = getCartUnits(cart) - getCartQuantity(cart, product.productId);
    const bounds: { limit: QuantityLimit; max: number }[] = [
        { limit: 'AVAILABILITY', max: product.availableQuantity },
        { limit: 'PRODUCT_LIMIT', max: ONLINE_MAX_UNITS_PER_PRODUCT },
        {
            limit: 'RESERVATION_LIMIT',
            max: ONLINE_MAX_UNITS_PER_RESERVATION - unitsOfOtherProducts,
        },
    ];
    const tightest = bounds.reduce((lowest, bound) => (bound.max < lowest.max ? bound : lowest));
    return { limit: tightest.limit, max: Math.max(0, tightest.max) };
};

/** The most units of the product the customer may have in the cart. */
export const getMaxQuantity = (cart: Cart, product: CartProduct): number =>
    getQuantityBound(cart, product).max;

/** Why the product's quantity cannot be increased, or `null` if it can. */
export const getQuantityLimit = (cart: Cart, product: CartProduct): QuantityLimit | null => {
    const { limit, max } = getQuantityBound(cart, product);
    return getCartQuantity(cart, product.productId) >= max ? limit : null;
};

/**
 * Increases are capped at the displayed availability and the online limits. Decreases are
 * always allowed, even while the quantity is above a limit that has since dropped, so the
 * cart is never changed by more than the customer asked for.
 */
export const cartReducer = (cart: Cart, action: CartAction): Cart => {
    if (action.type === 'remove') {
        return cart.filter((line) => line.productId !== action.productId);
    }
    const { product, quantity: requested } = action;
    if (!Number.isInteger(requested)) {
        return cart;
    }
    const current = getCartQuantity(cart, product.productId);
    const quantity = Math.max(
        0,
        Math.min(requested, Math.max(current, getMaxQuantity(cart, product))),
    );
    if (quantity === 0) {
        return cart.filter((line) => line.productId !== product.productId);
    }
    const line: CartLine = { ...product, quantity };
    return current === 0
        ? [...cart, line]
        : cart.map((existing) => (existing.productId === product.productId ? line : existing));
};
