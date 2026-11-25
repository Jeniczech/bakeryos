import type { QuantityLimit } from '@/lib/cart/cart';
import {
    ONLINE_MAX_UNITS_PER_PRODUCT,
    ONLINE_MAX_UNITS_PER_RESERVATION,
} from '@/lib/validation/reservation';

/** Short enough to fit beside the stepper in two lines, so the card never changes height. */
export const QUANTITY_LIMIT_MESSAGES: Record<QuantityLimit, string> = {
    AVAILABILITY: 'Víc kusů už nezbývá.',
    PRODUCT_LIMIT: `Online max. ${ONLINE_MAX_UNITS_PER_PRODUCT} ks. Víc vyřídíme po telefonu.`,
    RESERVATION_LIMIT: `Online max. ${ONLINE_MAX_UNITS_PER_RESERVATION} ks celkem. Víc vyřídíme po telefonu.`,
};
