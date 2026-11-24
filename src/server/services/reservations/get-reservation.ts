import { eq } from 'drizzle-orm';
import { getDb, type DbExecutor } from '@/server/db/client';
import { reservationItems, reservations } from '@/server/db/schema';
import { ReservationNotFoundError } from '@/server/domain/errors';
import {
    getOnlineCutoff,
    isBeforeOnlineCutoff,
    type ReservationStatus,
} from '@/server/domain/reservation-rules';
import { compareConfirmationItems, type ReservationConfirmationItem } from './create-reservation';
import { hashManagementToken, isWellFormedManagementToken } from './management-token';

/** What a management-link holder may see; the phone number is deliberately left out. */
export type ReservationDetails = {
    reservationId: string;
    reservationNumber: string;
    pickupDate: string;
    status: ReservationStatus;
    customerName: string;
    totalPrice: number; // haléře
    items: ReservationConfirmationItem[];
    cancellationCutoff: Date;
    /** Whether the customer may still cancel: `confirmed` and strictly before the cutoff. */
    canCancel: boolean;
};

/** Returns null for malformed and unknown tokens alike. */
export const findReservationIdByToken = async (
    db: DbExecutor,
    token: string,
): Promise<string | null> => {
    if (!isWellFormedManagementToken(token)) {
        return null;
    }
    const [row] = await db
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.managementTokenHash, hashManagementToken(token)));
    return row?.id ?? null;
};

export const loadReservationDetails = async (
    db: DbExecutor,
    reservationId: string,
    now: Date,
): Promise<ReservationDetails> => {
    const [reservation] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId));
    if (!reservation) {
        throw new ReservationNotFoundError();
    }
    const items = await db
        .select({
            productId: reservationItems.productId,
            productName: reservationItems.productNameSnapshot,
            unitPrice: reservationItems.unitPriceSnapshot,
            quantity: reservationItems.quantity,
        })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, reservationId));
    return {
        reservationId: reservation.id,
        reservationNumber: reservation.reservationNumber,
        pickupDate: reservation.pickupDate,
        status: reservation.status,
        customerName: reservation.customerName,
        totalPrice: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
        items: items.sort(compareConfirmationItems),
        cancellationCutoff: getOnlineCutoff(reservation.pickupDate),
        canCancel:
            reservation.status === 'confirmed' && isBeforeOnlineCutoff(reservation.pickupDate, now),
    };
};

export const getReservationByToken = async (
    token: string,
    options: { now?: Date } = {},
): Promise<ReservationDetails> => {
    const reservationId = await findReservationIdByToken(getDb(), token);
    if (!reservationId) {
        throw new ReservationNotFoundError();
    }
    return loadReservationDetails(getDb(), reservationId, options.now ?? new Date());
};
