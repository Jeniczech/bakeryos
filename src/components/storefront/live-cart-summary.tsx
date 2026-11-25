import { connection } from 'next/server';
import { CartSummary, type CartCatalog } from './cart-summary';
import { CheckoutButton } from './checkout-button';
import { getLiveCatalog } from './live-catalog';

/** The per-request live catalog the product cards use, as far as the cart needs it. */
const getCartCatalog = async (pickupDate: string): Promise<CartCatalog> => {
    await connection();
    const live = await getLiveCatalog(pickupDate);
    if (live.status !== 'open') {
        return live;
    }
    return {
        status: 'open',
        products: [...live.products.values()].map((product) => ({
            productId: product.id,
            name: product.name,
            unitPrice: product.price,
            availableQuantity: product.remainingQuantity,
        })),
    };
};

/** The cart, checked against the same per-request live catalog as the product cards. */
export const LiveCartSummary = async ({ pickupDate }: { pickupDate: string }) => (
    <CartSummary catalog={await getCartCatalog(pickupDate)} pickupDate={pickupDate} />
);

/** The submit button, enabled against the same live catalog as the cart. */
export const LiveCheckoutButton = async ({ pickupDate }: { pickupDate: string }) => (
    <CheckoutButton catalog={await getCartCatalog(pickupDate)} pickupDate={pickupDate} />
);
