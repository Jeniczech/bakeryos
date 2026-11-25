import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';

/** Staff-facing Czech copy for phone reservations; the same rules apply as online. */
export const ADMIN_PICKUP_DATE_MESSAGES: Record<PickupDateRejectionReason, string> = {
    INVALID_DATE: 'Neplatné datum vyzvednutí.',
    OUTSIDE_BOOKING_WINDOW: 'Rezervaci lze vytvořit od zítřka nejvýše 7 dní dopředu.',
    CUTOFF_PASSED:
        'Rezervace na tento den skončily v 18:00 předchozího dne, výroba je už naplánovaná.',
    BAKERY_CLOSED: 'Pekárna má v tento den zavřeno.',
};
