import { ReservationStatusActions } from '@/components/admin/reservation-status-actions';
import { formatPrice } from '@/lib/formatting/money';
import type { ReservationSource, ReservationStatus } from '@/server/domain/reservation-rules';
import type { DailyReservation } from '@/server/services/reservations/get-daily-reservations';

const STATUS_LABELS: Record<ReservationStatus, string> = {
    confirmed: 'Potvrzeno',
    picked_up: 'Vyzvednuto',
    no_show: 'Nevyzvednuto',
    cancelled: 'Zrušeno',
};

const STATUS_CLASSES: Record<ReservationStatus, string> = {
    confirmed: 'bg-amber-100 text-amber-900',
    picked_up: 'bg-green-100 text-green-900',
    no_show: 'bg-orange-100 text-orange-900',
    cancelled: 'bg-stone-200 text-stone-700',
};

const SOURCE_LABELS: Record<ReservationSource, string> = {
    online: 'Online',
    admin: 'Telefonicky',
};

export const ReservationList = ({
    reservations,
    cancellationRetainsProduction,
}: {
    reservations: readonly DailyReservation[];
    cancellationRetainsProduction: boolean;
}) => (
    <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
            <thead className="border-b border-amber-200 bg-amber-50 text-stone-600">
                <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Číslo
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Zákazník
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Položky
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Celkem
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Stav
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                        <span className="sr-only">Akce</span>
                    </th>
                </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
                {reservations.map((reservation) => (
                    <tr key={reservation.reservationId} className="align-top">
                        <td className="px-4 py-3 whitespace-nowrap">
                            <div className="font-medium text-stone-900">
                                {reservation.reservationNumber}
                            </div>
                            <div className="text-stone-500">
                                {SOURCE_LABELS[reservation.source]}
                            </div>
                        </td>
                        <td className="px-4 py-3">
                            <div className="font-medium text-stone-900">
                                {reservation.customerName}
                            </div>
                            <a
                                href={`tel:${reservation.customerPhone}`}
                                className="whitespace-nowrap text-amber-900 underline-offset-2 hover:underline"
                            >
                                {reservation.customerPhone}
                            </a>
                        </td>
                        <td className="px-4 py-3">
                            <ul>
                                {reservation.items.map((item) => (
                                    <li key={item.productId}>
                                        {item.quantity}× {item.productName}
                                    </li>
                                ))}
                            </ul>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                            {formatPrice(reservation.totalPrice)}
                        </td>
                        <td className="px-4 py-3">
                            <span
                                className={`inline-block rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap ${STATUS_CLASSES[reservation.status]}`}
                            >
                                {STATUS_LABELS[reservation.status]}
                            </span>
                            {reservation.retainForProduction && (
                                <div className="mt-1 text-xs text-stone-500">
                                    Po uzávěrce, zůstává ve výrobě
                                </div>
                            )}
                        </td>
                        <td className="px-4 py-3">
                            <ReservationStatusActions
                                reservationId={reservation.reservationId}
                                reservationNumber={reservation.reservationNumber}
                                allowedTargets={reservation.allowedStatusTargets}
                                cancellationRetainsProduction={cancellationRetainsProduction}
                            />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
