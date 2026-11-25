import type { CalendarDate } from '@/lib/date-time/prague';
import { normalizeItems, normalizePhone } from '@/lib/validation/reservation';
import type { Cart } from './cart';
import type { CustomerDetails } from './customer-details';

/** The `POST /api/reservations` body without its idempotency key. */
export type ReservationPayload = {
    pickupDate: CalendarDate;
    customer: CustomerDetails;
    items: Array<{ productId: string; quantity: number }>;
};

/** The confirmation `POST /api/reservations` returns; prices in haléře. */
export type ReservationConfirmation = {
    reservationNumber: string;
    pickupDate: CalendarDate;
    status: string;
    totalPrice: number;
    items: Array<{ productId: string; productName: string; unitPrice: number; quantity: number }>;
    managementUrl: string;
};

/** The key a payload was last sent with, so an unchanged retry can reuse it. */
export type SubmissionAttempt = { idempotencyKey: string; fingerprint: string };

/**
 * Normalized as the server normalizes it, so formatting-only edits (spaces in the phone, item
 * order) count as the same request. Prices are never sent: the server reads them.
 */
export const buildReservationPayload = (
    pickupDate: CalendarDate,
    customer: CustomerDetails,
    cart: Cart,
): ReservationPayload => ({
    pickupDate,
    customer: { name: customer.name.trim(), phone: normalizePhone(customer.phone) },
    items: normalizeItems(cart.map(({ productId, quantity }) => ({ productId, quantity }))),
});

const fingerprintPayload = (payload: ReservationPayload): string => JSON.stringify(payload);

/**
 * The attempt to send `payload` with: the previous key when the payload is unchanged, so a
 * retry after a lost response cannot create a second reservation, and a new key otherwise.
 */
export const resolveSubmissionAttempt = (
    previous: SubmissionAttempt | null,
    payload: ReservationPayload,
    generateKey: () => string,
): SubmissionAttempt => {
    const fingerprint = fingerprintPayload(payload);
    if (previous?.fingerprint === fingerprint) {
        return previous;
    }
    return { idempotencyKey: generateKey(), fingerprint };
};
