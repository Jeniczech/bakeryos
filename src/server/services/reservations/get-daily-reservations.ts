import { asc, eq, inArray } from 'drizzle-orm';
import { calendarDateSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { reservationItems, reservations } from '@/server/db/schema';
import { InvalidRequestError, toValidationIssues } from '@/server/domain/errors';
import {
    listAdminStatusTargets,
    type AdminStatusTarget,
    type ReservationSource,
    type ReservationStatus,
} from '@/server/domain/reservation-rules';
import { compareConfirmationItems, type ReservationConfirmationItem } from './create-reservation';

/** One row of the admin reservation list; admins see the phone number. */
export type DailyReservation = {
    reservationId: string;
    reservationNumber: string;
    customerName: string;
    customerPhone: string;
    source: ReservationSource;
    status: ReservationStatus;
    /** A late cancellation whose items stay in production. */
    retainForProduction: boolean;
    createdAt: Date;
    totalPrice: number; // haléře
    items: ReservationConfirmationItem[];
    /** The status changes an admin may make right now. */
    allowedStatusTargets: AdminStatusTarget[];
};

/** Every reservation for a pickup date, in reservation-number order. `now` is injectable for tests. */
export const getDailyReservations = async (
    date: string,
    options: { now?: Date } = {},
): Promise<DailyReservation[]> => {
    const parsedDate = calendarDateSchema.safeParse(date);
    if (!parsedDate.success) {
        throw new InvalidRequestError(toValidationIssues(parsedDate.error));
    }
    const pickupDate = parsedDate.data;
    const now = options.now ?? new Date();
    const rows = await getDb()
        .select()
        .from(reservations)
        .where(eq(reservations.pickupDate, pickupDate))
        .orderBy(asc(reservations.reservationNumber));
    if (rows.length === 0) {
        return [];
    }
    const itemRows = await getDb()
        .select({
            reservationId: reservationItems.reservationId,
            productId: reservationItems.productId,
            productName: reservationItems.productNameSnapshot,
            unitPrice: reservationItems.unitPriceSnapshot,
            quantity: reservationItems.quantity,
        })
        .from(reservationItems)
        .where(
            inArray(
                reservationItems.reservationId,
                rows.map((row) => row.id),
            ),
        );
    const itemsByReservation = Map.groupBy(itemRows, (item) => item.reservationId);

    return rows.map((row) => {
        const items = (itemsByReservation.get(row.id) ?? [])
            .map(({ productId, productName, unitPrice, quantity }) => ({
                productId,
                productName,
                unitPrice,
                quantity,
            }))
            .sort(compareConfirmationItems);
        return {
            reservationId: row.id,
            reservationNumber: row.reservationNumber,
            customerName: row.customerName,
            customerPhone: row.customerPhone,
            source: row.source,
            status: row.status,
            retainForProduction: row.retainForProduction,
            createdAt: row.createdAt,
            totalPrice: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
            items,
            allowedStatusTargets: listAdminStatusTargets(row, now),
        };
    });
};
