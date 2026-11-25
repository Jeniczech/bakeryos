import { CustomerDetailsCard } from './customer-details-card';

/**
 * The page content beside the cart, the customer's details, and the submit button: a sidebar on large screens and
 * below the content otherwise. The sidebar scrolls with the page rather than sticking: a long
 * cart would otherwise need its own scrollbar. The details sit outside the page's cart slot,
 * and so outside its loading boundary.
 */
export const CartColumns = ({
    cart,
    checkout,
    children,
}: {
    cart: React.ReactNode;
    checkout: React.ReactNode;
    children: React.ReactNode;
}) => (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-4">{children}</div>
        <aside className="flex flex-col gap-4">
            {cart}
            <CustomerDetailsCard />
            {checkout}
        </aside>
    </div>
);
