import { describe, expect, it } from 'vitest';
import { describeCancelFailure } from '@/lib/reservations/cancellation';

describe('describeCancelFailure', () => {
    it.each([
        ['CUTOFF_PASSED', 'CUTOFF_PASSED'],
        ['INVALID_TRANSITION', 'NOT_CANCELLABLE'],
        ['FORBIDDEN', 'NOT_CANCELLABLE'],
        ['RESERVATION_NOT_FOUND', 'NOT_FOUND'],
    ] as const)('refreshes the page for %s, whose state is out of date', (code, kind) => {
        expect(describeCancelFailure(code)).toEqual({ kind, refreshPage: true });
    });

    it.each([null, 'INTERNAL_ERROR', 'SOMETHING_NEW'])(
        'asks for a retry without refreshing for %s',
        (code) => {
            expect(describeCancelFailure(code)).toEqual({ kind: 'RETRY', refreshPage: false });
        },
    );
});
