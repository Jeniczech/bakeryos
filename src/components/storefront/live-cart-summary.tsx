import { connection } from 'next/server';
import { CartSummary, type CartCatalog } from './cart-summary';
import { getLiveCatalog } from './live-catalog';

/** The cart, checked against the same per-request live catalog as the product cards. */
export const LiveCartSummary = async ({ pickupDate }: { pickupDate: string }) => {
    await connection();
    const live = await getLiveCatalog(pickupDate);
    const catalog: CartCatalog =
        live.status === 'open'
            ? {
                  status: 'open',
                  products: [...live.products.values()].map((product) => ({
                      productId: product.id,
                      name: product.name,
                      unitPrice: product.price,
                      availableQuantity: product.remainingQuantity,
                  })),
              }
            : live;
    return <CartSummary catalog={catalog} />;
};
