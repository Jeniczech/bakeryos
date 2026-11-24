import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';

// Customer-facing Czech copy; API Problem Details keep their own English messages.

/** Short labels for unavailable days in the date picker. */
export const PICKUP_DATE_LABELS: Record<PickupDateRejectionReason, string> = {
    INVALID_DATE: 'Nedostupné',
    OUTSIDE_BOOKING_WINDOW: 'Nedostupné',
    CUTOFF_PASSED: 'Po uzávěrce',
    BAKERY_CLOSED: 'Zavřeno',
};

export const PICKUP_DATE_MESSAGES: Record<PickupDateRejectionReason, string> = {
    INVALID_DATE: 'Datum vyzvednutí není platné.',
    OUTSIDE_BOOKING_WINDOW:
        'Na tento den nelze rezervovat online. Vyberte prosím některý z nabízených dnů.',
    CUTOFF_PASSED: 'Online objednávky na tento den skončily v 18:00 předchozího dne.',
    BAKERY_CLOSED: 'V tento den má pekárna zavřeno.',
};
