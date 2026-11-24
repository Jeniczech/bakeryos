import { z } from 'zod';
import { isValidCalendarDate } from '@/lib/date-time/prague';

export const ONLINE_MAX_UNITS_PER_PRODUCT = 20;
export const ONLINE_MAX_UNITS_PER_RESERVATION = 50;
export const CUSTOMER_NAME_MAX_LENGTH = 100;
export const MAX_ITEMS_PER_REQUEST = 100;

const PHONE_PATTERN = /^\+?\d{9,15}$/;

/** Strips spaces, dashes, and parentheses; validation happens on the result. */
export const normalizePhone = (phone: string): string => phone.replace(/[\s\-()]/g, '');

export const phoneSchema = z
    .string()
    .transform(normalizePhone)
    .pipe(
        z
            .string()
            .regex(
                PHONE_PATTERN,
                'Enter a phone number with 9–15 digits, optionally starting with +.',
            ),
    );

export const customerNameSchema = z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(CUSTOMER_NAME_MAX_LENGTH, `Name must be at most ${CUSTOMER_NAME_MAX_LENGTH} characters.`);

export const calendarDateSchema = z
    .string()
    .refine(isValidCalendarDate, 'Enter a valid date in YYYY-MM-DD format.');

export type ReservationItemInput = { productId: string; quantity: number };

/** Merges duplicate products by summing quantities and sorts by product ID. */
export const normalizeItems = (items: readonly ReservationItemInput[]): ReservationItemInput[] => {
    const quantities = new Map<string, number>();
    for (const { productId, quantity } of items) {
        quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
    }
    return [...quantities]
        .map(([productId, quantity]) => ({ productId, quantity }))
        .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
};

export type OnlineQuantityLimitViolation =
    | { reason: 'PRODUCT_LIMIT_EXCEEDED'; productId: string; quantity: number }
    | { reason: 'RESERVATION_LIMIT_EXCEEDED'; quantity: number };

/** Expects normalized items, so per-product limits apply to merged quantities. */
export const findOnlineQuantityLimitViolation = (
    items: readonly ReservationItemInput[],
): OnlineQuantityLimitViolation | null => {
    const overLimit = items.find((item) => item.quantity > ONLINE_MAX_UNITS_PER_PRODUCT);
    if (overLimit) {
        return { reason: 'PRODUCT_LIMIT_EXCEEDED', ...overLimit };
    }
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (total > ONLINE_MAX_UNITS_PER_RESERVATION) {
        return { reason: 'RESERVATION_LIMIT_EXCEEDED', quantity: total };
    }
    return null;
};

/** Lowercased so merging, sorting, and request hashing match PostgreSQL uuid equality and order. */
export const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

const itemSchema = z.object({
    productId: uuidSchema,
    quantity: z.int().positive(),
});

export const reservationRequestSchema = z.object({
    idempotencyKey: uuidSchema,
    pickupDate: calendarDateSchema,
    customer: z.object({ name: customerNameSchema, phone: phoneSchema }),
    items: z
        .array(itemSchema)
        .min(1, 'Add at least one product.')
        .max(MAX_ITEMS_PER_REQUEST, `Add at most ${MAX_ITEMS_PER_REQUEST} items.`)
        .transform(normalizeItems),
});

export type ReservationRequest = z.output<typeof reservationRequestSchema>;

export const onlineReservationRequestSchema = reservationRequestSchema.superRefine(
    (request, context) => {
        const violation = findOnlineQuantityLimitViolation(request.items);
        if (violation?.reason === 'PRODUCT_LIMIT_EXCEEDED') {
            context.addIssue({
                code: 'custom',
                path: ['items'],
                message: `Online reservations are limited to ${ONLINE_MAX_UNITS_PER_PRODUCT} units per product.`,
            });
        } else if (violation?.reason === 'RESERVATION_LIMIT_EXCEEDED') {
            context.addIssue({
                code: 'custom',
                path: ['items'],
                message: `Online reservations are limited to ${ONLINE_MAX_UNITS_PER_RESERVATION} units in total.`,
            });
        }
    },
);
