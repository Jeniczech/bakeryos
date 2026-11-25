import { connection } from 'next/server';
import { formatPrice } from '@/lib/formatting/money';
import { getLiveCatalog } from './live-catalog';
import { ProductCartControl } from './product-cart-control';

export const ProductAvailabilitySkeleton = () => (
    <span aria-hidden="true" className="block h-6 w-40 animate-pulse rounded bg-amber-100" />
);

const Message = ({ children }: { children: React.ReactNode }) => (
    <span className="text-sm text-stone-500">{children}</span>
);

/**
 * The card's price and remaining quantity, read per request so the price is current and the
 * quantity reflects new reservations. Informational: `createReservation` rechecks both.
 */
export const ProductAvailability = async ({
    pickupDate,
    productId,
}: {
    pickupDate: string;
    productId: string;
}) => {
    await connection();
    const catalog = await getLiveCatalog(pickupDate);
    if (catalog.status === 'closed') {
        return <Message>Na tento den už rezervace nepřijímáme.</Message>;
    }
    if (catalog.status === 'failed') {
        return <Message>Cenu a dostupnost se nepodařilo načíst. Zkuste stránku obnovit.</Message>;
    }
    // Missing when the product was deactivated or unscheduled after the catalog was cached.
    const product = catalog.products.get(productId);
    if (!product) {
        return <Message>Tento produkt už nelze rezervovat.</Message>;
    }
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-amber-950">{formatPrice(product.price)}</span>
                {product.remainingQuantity > 0 ? (
                    <span className="text-sm text-emerald-800">
                        Zbývá {product.remainingQuantity} ks
                    </span>
                ) : (
                    <span className="text-sm font-medium text-stone-500">Vyprodáno</span>
                )}
            </div>
            <ProductCartControl
                pickupDate={pickupDate}
                product={{
                    productId: product.id,
                    name: product.name,
                    availableQuantity: product.remainingQuantity,
                }}
            />
        </div>
    );
};
