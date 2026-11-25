import type { QuantityLimit } from '@/lib/cart/cart';
import { QUANTITY_LIMIT_MESSAGES } from './cart-messages';

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
