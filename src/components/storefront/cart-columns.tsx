/** The page content beside the cart: a sticky sidebar on large screens, below it otherwise. */
export const CartColumns = ({
    cart,
    children,
}: {
    cart: React.ReactNode;
    children: React.ReactNode;
}) => (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-4">{children}</div>
        <aside className="lg:sticky lg:top-6">{cart}</aside>
    </div>
);
