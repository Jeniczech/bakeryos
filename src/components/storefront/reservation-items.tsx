import { formatPrice } from '@/lib/formatting/money';

export type ReservationItemLine = {
    productId: string;
    productName: string;
    unitPrice: number; // haléře
    quantity: number;
};

/** The reserved items as the server stored them: snapshot names and prices, not the catalog's. */
export const ReservationItems = ({
    items,
    totalPrice,
}: {
    items: ReservationItemLine[];
    totalPrice: number;
}) => (
    <section
        aria-labelledby="reservation-items-heading"
        className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
    >
        <h2 id="reservation-items-heading" className="text-lg font-semibold text-amber-950">
            Rezervované pečivo
        </h2>
        <ul className="flex flex-col divide-y divide-amber-100">
            {items.map((item) => (
                <li key={item.productId} className="flex items-baseline justify-between gap-3 py-2">
                    <span>
                        <span className="font-medium text-amber-950">{item.productName}</span>{' '}
                        <span className="text-sm text-stone-500">
                            {item.quantity} × {formatPrice(item.unitPrice)}
                        </span>
                    </span>
                    <span className="font-semibold">
                        {formatPrice(item.unitPrice * item.quantity)}
                    </span>
                </li>
            ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-amber-200 pt-3">
            <span className="font-semibold text-amber-950">Celkem</span>
            <span className="text-lg font-semibold text-amber-950">{formatPrice(totalPrice)}</span>
        </div>
    </section>
);
