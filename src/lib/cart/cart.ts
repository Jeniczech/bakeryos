import { findOnlineQuantityLimitViolation } from '@/lib/validation/reservation';

/**
 * What the cart keeps per product. Prices and availability are never stored: they are read
 * from the selected date's live catalog whenever the cart renders. The name is kept so lines
 * whose product is not offered on the selected date can still be shown.
 */
export type CartLine = { productId: string; name: string; quantity: number };

/** Lines in the order they were added. */
export type Cart = readonly CartLine[];

/** A product as currently displayed for the selected date. */
export type CartProduct = { productId: string; name: string; availableQuantity: number };

/** A product of the selected date's live catalog; price in haléře. */
export type LiveProduct = CartProduct & { unitPrice: number };

export type CartAction =
    | { type: 'setQuantity'; product: CartProduct; quantity: number }
    | { type: 'remove'; productId: string };

export type QuantityLimit = 'AVAILABILITY' | 'PRODUCT_LIMIT' | 'RESERVATION_LIMIT';

export const getCartQuantity = (cart: Cart, productId: string): number =>
    cart.find((line) => line.productId === productId)?.quantity ?? 0;

const withQuantity = (cart: Cart, product: CartProduct, quantity: number): Cart => {
    if (quantity === 0) {
        return cart.filter((line) => line.productId !== product.productId);
    }
    const line: CartLine = { productId: product.productId, name: product.name, quantity };
    return getCartQuantity(cart, product.productId) === 0
        ? [...cart, line]
        : cart.map((existing) => (existing.productId === product.productId ? line : existing));
};

/**
 * Why the cart cannot hold `quantity` units of the product, or `null` if it can. The online
 * limits come from the same check the server applies at submission.
 */
const findQuantityLimit = (
    cart: Cart,
    product: CartProduct,
    quantity: number,
): QuantityLimit | null => {
    if (quantity > product.availableQuantity) {
        return 'AVAILABILITY';
    }
    const violation = findOnlineQuantityLimitViolation(withQuantity(cart, product, quantity));
    if (violation === null) {
        return null;
    }
    return violation.reason === 'PRODUCT_LIMIT_EXCEEDED' ? 'PRODUCT_LIMIT' : 'RESERVATION_LIMIT';
};

/** Why one more unit of the product cannot be added, or `null` if it can. */
export const getQuantityLimit = (cart: Cart, product: CartProduct): QuantityLimit | null =>
    findQuantityLimit(cart, product, getCartQuantity(cart, product.productId) + 1);

/**
 * Increases beyond the displayed availability or the online limits are ignored. Decreases are
 * always allowed, even while the quantity is above a limit that has since dropped, so the
 * cart never changes by more than the customer asked for.
 */
export const cartReducer = (cart: Cart, action: CartAction): Cart => {
    if (action.type === 'remove') {
        return cart.filter((line) => line.productId !== action.productId);
    }
    const { product, quantity } = action;
    if (!Number.isInteger(quantity) || quantity < 0) {
        return cart;
    }
    const isIncrease = quantity > getCartQuantity(cart, product.productId);
    if (isIncrease && findQuantityLimit(cart, product, quantity) !== null) {
        return cart;
    }
    return withQuantity(cart, product, quantity);
};

export type CartLineIssue = 'NOT_OFFERED' | 'EXCEEDS_AVAILABILITY';

export type ReviewedCartLine = {
    line: CartLine;
    /** `null` when the product cannot be reserved on the selected date. */
    product: LiveProduct | null;
    issue: CartLineIssue | null;
};

/**
 * The cart checked against the selected date's live catalog. Lines are flagged, never changed.
 * Units and total cover only lines offered on that date, at their current prices.
 */
export const reviewCart = (
    cart: Cart,
    products: readonly LiveProduct[],
): { lines: ReviewedCartLine[]; units: number; total: number } => {
    const productsById = new Map(products.map((product) => [product.productId, product]));
    const lines = cart.map((line): ReviewedCartLine => {
        const product = productsById.get(line.productId) ?? null;
        if (product === null) {
            return { line, product, issue: 'NOT_OFFERED' };
        }
        const issue = line.quantity > product.availableQuantity ? 'EXCEEDS_AVAILABILITY' : null;
        return { line, product, issue };
    });
    let units = 0;
    let total = 0;
    for (const { line, product } of lines) {
        if (product) {
            units += line.quantity;
            total += line.quantity * product.unitPrice;
        }
    }
    return { lines, units, total };
};
