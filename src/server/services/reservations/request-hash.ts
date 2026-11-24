import { createHash } from 'node:crypto';
import type { ReservationRequest } from '@/lib/validation/reservation';
import type { ReservationSource } from '@/server/domain/reservation-rules';

/**
 * SHA-256 of the normalized request (trimmed name, normalized phone, merged and sorted
 * lowercase items) plus the trusted source. The idempotency key itself is excluded. The
 * object is built field by field so the JSON key order, and therefore the hash, is stable.
 */
export const computeRequestHash = (
    request: Omit<ReservationRequest, 'idempotencyKey'>,
    source: ReservationSource,
): string => {
    const canonical = {
        version: 1,
        source,
        pickupDate: request.pickupDate,
        customer: { name: request.customer.name, phone: request.customer.phone },
        items: request.items.map((item) => [item.productId, item.quantity]),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};
