import { describe, expect, it } from 'vitest';
import { describeCancelFailure } from '@/lib/reservations/cancellation';

describe('describeCancelFailure', () => {
    it.each([
        ['PICKUP_DATE_PASSED', 'PICKUP_DATE_PASSED'],
        ['INVALID_TRANSITION', 'NOT_CANCELLABLE'],
        ['RESERVATION_NOT_FOUND', 'NOT_FOUND'],
    ] as const)('maps %s to %s', (code, kind) => {
        expect(describeCancelFailure(code)).toBe(kind);
    });

    it.each([null, 'INTERNAL_ERROR', 'SOMETHING_NEW'])('asks for a retry for %s', (code) => {
        expect(describeCancelFailure(code)).toBe('RETRY');
    });
});
