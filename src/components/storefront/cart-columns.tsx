import { CustomerDetailsCard } from './customer-details-card';

/**
 * The page content beside the cart and the customer's details: a sticky sidebar on large
 * screens, which scrolls as a whole when taller than the viewport, and below the content
 * otherwise. The details sit outside the page's cart slot, and so outside its loading boundary.
 */
export const CartColumns = ({
    cart,
    children,
}: {
    cart: React.ReactNode;
    children: React.ReactNode;
}) => (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-4">{children}</div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            {cart}
            <CustomerDetailsCard />
        </aside>
    </div>
);
