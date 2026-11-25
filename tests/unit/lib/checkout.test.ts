import { describe, expect, it } from 'vitest';
import { buildReservationPayload, resolveSubmissionAttempt } from '@/lib/cart/checkout';

const BREAD = '22222222-2222-4222-8222-222222222222';
const ROLL = '11111111-1111-4111-8111-111111111111';

const cart = [
    { productId: BREAD, name: 'Chléb', quantity: 2 },
    { productId: ROLL, name: 'Rohlík', quantity: 5 },
];

const keys = () => {
    let next = 0;
    return () => `key-${++next}`;
};

describe('buildReservationPayload', () => {
    it('normalizes the customer and items as the server does, without names or prices', () => {
        expect(
            buildReservationPayload(
                '2026-11-27',
                { name: ' Jana ', phone: '+420 777 123-456' },
                cart,
            ),
        ).toEqual({
            pickupDate: '2026-11-27',
            customer: { name: 'Jana', phone: '+420777123456' },
            items: [
                { productId: ROLL, quantity: 5 },
                { productId: BREAD, quantity: 2 },
            ],
        });
    });
});

describe('resolveSubmissionAttempt', () => {
    const customer = { name: 'Jana', phone: '777123456' };
    const payload = buildReservationPayload('2026-11-27', customer, cart);

    it('generates a key for the first attempt', () => {
        expect(resolveSubmissionAttempt(null, payload, keys()).idempotencyKey).toBe('key-1');
    });

    it('reuses the key for an unchanged retry, including formatting-only edits', () => {
        const generate = keys();
        const first = resolveSubmissionAttempt(null, payload, generate);
        const reformatted = buildReservationPayload(
            '2026-11-27',
            { name: ' Jana', phone: '777 123 456' },
            [...cart].reverse(),
        );
        expect(resolveSubmissionAttempt(first, reformatted, generate)).toBe(first);
    });

    it('generates a new key when the payload changes', () => {
        const generate = keys();
        const first = resolveSubmissionAttempt(null, payload, generate);
        const changes = [
            buildReservationPayload('2026-11-28', customer, cart),
            buildReservationPayload('2026-11-27', { ...customer, name: 'Petr' }, cart),
            buildReservationPayload('2026-11-27', customer, [{ ...cart[0], quantity: 3 }]),
        ];
        expect(
            changes.map((changed) => resolveSubmissionAttempt(first, changed, generate)),
        ).toEqual([
            expect.objectContaining({ idempotencyKey: 'key-2' }),
            expect.objectContaining({ idempotencyKey: 'key-3' }),
            expect.objectContaining({ idempotencyKey: 'key-4' }),
        ]);
    });
});
