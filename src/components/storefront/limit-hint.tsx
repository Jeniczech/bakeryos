import type { QuantityLimit } from '@/lib/cart/cart';
import {
    ONLINE_MAX_UNITS_PER_PRODUCT,
    ONLINE_MAX_UNITS_PER_RESERVATION,
} from '@/lib/validation/reservation';

/** Short enough to fit beside the stepper in two lines, so the card never changes height. */
const QUANTITY_LIMIT_MESSAGES: Record<QuantityLimit, string> = {
    AVAILABILITY: 'Víc kusů už nezbývá.',
    PRODUCT_LIMIT: `Online max. ${ONLINE_MAX_UNITS_PER_PRODUCT} ks.`,
    RESERVATION_LIMIT: `Online max. ${ONLINE_MAX_UNITS_PER_RESERVATION} ks celkem.`,
};

/**
 * The add button and the stepper share this fixed-height row, and limit hints sit inside it,
 * so switching between them never moves the price above.
 */
export const CART_CONTROL_ROW_CLASSES = 'flex h-10 items-center gap-2';

export const LimitHint = ({ limit }: { limit: QuantityLimit }) => (
    <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-tight text-stone-500">
        {QUANTITY_LIMIT_MESSAGES[limit]}
    </p>
);

/**
 * Replaces the limit hint while the cart holds more units than are left, for example after
 * someone else reserved them, so the card says the quantity has to go down, as the cart does.
 * The availability line above already says how many are left.
 */
export const OverAvailabilityHint = ({ availableQuantity }: { availableQuantity: number }) => (
    <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-tight text-orange-800">
        {availableQuantity === 0 ? 'Odeberte z košíku.' : 'Snižte množství v košíku.'}
    </p>
);
