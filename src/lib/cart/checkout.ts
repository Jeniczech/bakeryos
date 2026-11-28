import { z } from 'zod';
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

/**
 * The confirmation `POST /api/reservations` returns; prices in haléře. Parsed rather than cast
 * on the client: it is read from the response and from `sessionStorage`.
 */
export const reservationConfirmationSchema = z.object({
    reservationNumber: z.string(),
    pickupDate: z.string(),
    status: z.enum(['confirmed', 'picked_up', 'cancelled', 'no_show']),
    totalPrice: z.int(),
    items: z.array(
        z.object({
            productId: z.string(),
            productName: z.string(),
            unitPrice: z.int(),
            quantity: z.int(),
        }),
    ),
    managementUrl: z.string(),
});

export type ReservationConfirmation = z.infer<typeof reservationConfirmationSchema>;

/**
 * The key a payload was last sent with, so an unchanged retry can reuse it. The payload is kept
 * only as a SHA-256 hash: the attempt is stored in `sessionStorage`, and the payload holds the
 * customer's name and phone.
 */
export const submissionAttemptSchema = z.object({
    idempotencyKey: z.string(),
    fingerprint: z.string(),
});

export type SubmissionAttempt = z.infer<typeof submissionAttemptSchema>;

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

const fingerprintPayload = async (payload: ReservationPayload): Promise<string> => {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(payload)),
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
    );
};

/**
 * The attempt to send `payload` with: the previous key when the payload is unchanged, so a
 * retry after a lost response cannot create a second reservation, and a new key otherwise.
 */
export const resolveSubmissionAttempt = async (
    previous: SubmissionAttempt | null,
    payload: ReservationPayload,
    generateKey: () => string,
): Promise<SubmissionAttempt> => {
    const fingerprint = await fingerprintPayload(payload);
    if (previous?.fingerprint === fingerprint) {
        return previous;
    }
    return { idempotencyKey: generateKey(), fingerprint };
};

/** What a failed submission tells the customer; the UI maps each kind to its own copy. */
export type SubmitFailureKind =
    'CAPACITY' | 'UNAVAILABLE' | 'DATE_CLOSED' | 'RATE_LIMITED' | 'RETRY';

const FAILURE_KINDS_BY_CODE: Partial<Record<string, SubmitFailureKind>> = {
    INSUFFICIENT_CAPACITY: 'CAPACITY',
    PRODUCT_UNAVAILABLE: 'UNAVAILABLE',
    INVALID_DATE: 'DATE_CLOSED',
    OUTSIDE_BOOKING_WINDOW: 'DATE_CLOSED',
    CUTOFF_PASSED: 'DATE_CLOSED',
    BAKERY_CLOSED: 'DATE_CLOSED',
    RATE_LIMITED: 'RATE_LIMITED',
};

/**
 * Classifies a failed `POST /api/reservations` by its Problem Details `code` (`null` for a
 * network error or an unreadable body). `refreshCatalog` is set when the displayed catalog is
 * out of date, so a refresh lets the cart flag what the customer has to change.
 */
export const describeSubmitFailure = (
    code: string | null,
): { kind: SubmitFailureKind; refreshCatalog: boolean } => {
    const kind = (code && FAILURE_KINDS_BY_CODE[code]) || 'RETRY';
    return {
        kind,
        refreshCatalog: kind === 'CAPACITY' || kind === 'UNAVAILABLE' || kind === 'DATE_CLOSED',
    };
};

/**
 * Whether a failed submission's notice still applies. After a capacity or availability failure
 * the refreshed cart flags the lines to change itself, so that notice is shown only while the
 * cart flags nothing and still holds the items that were sent.
 */
export const isSubmitFailureShown = (
    failure: { kind: SubmitFailureKind; items: ReservationPayload['items'] },
    cart: Cart,
    flaggedLines: number,
): boolean => {
    if (failure.kind !== 'CAPACITY' && failure.kind !== 'UNAVAILABLE') {
        return true;
    }
    const cartItems = normalizeItems(
        cart.map(({ productId, quantity }) => ({ productId, quantity })),
    );
    return flaggedLines === 0 && JSON.stringify(cartItems) === JSON.stringify(failure.items);
};

/** Whole minutes from a `Retry-After` header in seconds, at least 1. */
export const parseRetryAfterMinutes = (header: string | null): number => {
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 1;
};
