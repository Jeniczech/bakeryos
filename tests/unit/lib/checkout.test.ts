import { describe, expect, it } from 'vitest';
import {
    buildReservationPayload,
    describeSubmitFailure,
    isSubmitFailureShown,
    parseRetryAfterMinutes,
    reservationConfirmationSchema,
    resolveSubmissionAttempt,
} from '@/lib/cart/checkout';

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

    it('generates a key for the first attempt and keeps no personal data', async () => {
        const attempt = await resolveSubmissionAttempt(null, payload, keys());
        expect(attempt.idempotencyKey).toBe('key-1');
        expect(attempt.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(attempt)).not.toMatch(/Jana|777123456/);
    });

    it('reuses the key for an unchanged retry, including formatting-only edits', async () => {
        const generate = keys();
        const first = await resolveSubmissionAttempt(null, payload, generate);
        const reformatted = buildReservationPayload(
            '2026-11-27',
            { name: ' Jana', phone: '777 123 456' },
            [...cart].reverse(),
        );
        expect(await resolveSubmissionAttempt(first, reformatted, generate)).toBe(first);
    });

    it('generates a new key when the payload changes', async () => {
        const generate = keys();
        const first = await resolveSubmissionAttempt(null, payload, generate);
        const changes = [
            buildReservationPayload('2026-11-28', customer, cart),
            buildReservationPayload('2026-11-27', { ...customer, name: 'Petr' }, cart),
            buildReservationPayload('2026-11-27', customer, [{ ...cart[0], quantity: 3 }]),
        ];
        const attempts = [];
        for (const changed of changes) {
            attempts.push(await resolveSubmissionAttempt(first, changed, generate));
        }
        expect(attempts.map((attempt) => attempt.idempotencyKey)).toEqual([
            'key-2',
            'key-3',
            'key-4',
        ]);
    });
});

describe('describeSubmitFailure', () => {
    it('asks for a catalog refresh when the displayed catalog is out of date', () => {
        expect(describeSubmitFailure('INSUFFICIENT_CAPACITY')).toEqual({
            kind: 'CAPACITY',
            refreshCatalog: true,
        });
        expect(describeSubmitFailure('PRODUCT_UNAVAILABLE').kind).toBe('UNAVAILABLE');
        expect(describeSubmitFailure('CUTOFF_PASSED')).toEqual({
            kind: 'DATE_CLOSED',
            refreshCatalog: true,
        });
    });

    it('reports rate limiting without a refresh', () => {
        expect(describeSubmitFailure('RATE_LIMITED')).toEqual({
            kind: 'RATE_LIMITED',
            refreshCatalog: false,
        });
    });

    it('falls back to a retry for unknown codes and network errors', () => {
        for (const code of ['INTERNAL_ERROR', 'IDEMPOTENCY_CONFLICT', null]) {
            expect(describeSubmitFailure(code)).toEqual({ kind: 'RETRY', refreshCatalog: false });
        }
    });
});

describe('isSubmitFailureShown', () => {
    const sent = buildReservationPayload(
        '2026-11-27',
        { name: 'Jana', phone: '777123456' },
        cart,
    ).items;
    const view = { cart, flaggedLines: 0, dateClosed: false };

    it('leaves a capacity or availability failure to the cart once it flags lines', () => {
        const flagged = { ...view, flaggedLines: 1 };
        expect(isSubmitFailureShown({ kind: 'CAPACITY', items: sent }, flagged)).toBe(false);
        expect(isSubmitFailureShown({ kind: 'UNAVAILABLE', items: sent }, flagged)).toBe(false);
    });

    it('hides a capacity failure once the cart is edited', () => {
        const edited = [cart[0]!, { ...cart[1]!, quantity: 3 }];
        expect(
            isSubmitFailureShown({ kind: 'CAPACITY', items: sent }, { ...view, cart: edited }),
        ).toBe(false);
    });

    it('shows a capacity failure while the unchanged cart flags nothing', () => {
        const reordered = [cart[1]!, cart[0]!];
        expect(
            isSubmitFailureShown({ kind: 'CAPACITY', items: sent }, { ...view, cart: reordered }),
        ).toBe(true);
    });

    it('leaves a passed deadline to the cart once it reports the date closed', () => {
        const failure = { kind: 'DATE_CLOSED', items: sent } as const;
        expect(isSubmitFailureShown(failure, { ...view, dateClosed: true })).toBe(false);
        expect(isSubmitFailureShown(failure, view)).toBe(true);
    });

    it('leaves a capacity or availability failure to the cart once the date closes', () => {
        const closed = { ...view, dateClosed: true };
        expect(isSubmitFailureShown({ kind: 'CAPACITY', items: sent }, closed)).toBe(false);
        expect(isSubmitFailureShown({ kind: 'UNAVAILABLE', items: sent }, closed)).toBe(false);
    });

    it('always shows failures the cart does not explain', () => {
        const busy = { cart: [], flaggedLines: 2, dateClosed: true };
        for (const kind of ['RATE_LIMITED', 'RETRY'] as const) {
            expect(isSubmitFailureShown({ kind, items: sent }, busy)).toBe(true);
        }
    });
});

describe('parseRetryAfterMinutes', () => {
    it('rounds seconds up to whole minutes, at least one', () => {
        expect(parseRetryAfterMinutes('61')).toBe(2);
        expect(parseRetryAfterMinutes('5')).toBe(1);
        expect(parseRetryAfterMinutes(null)).toBe(1);
        expect(parseRetryAfterMinutes('soon')).toBe(1);
    });
});

describe('reservationConfirmationSchema', () => {
    const confirmation = {
        reservationNumber: 'BK-000123',
        pickupDate: '2026-11-27',
        status: 'confirmed',
        totalPrice: 8400,
        items: [{ productId: BREAD, productName: 'Chléb', unitPrice: 4200, quantity: 2 }],
        managementUrl: 'https://example.test/reservations/manage/token',
    };

    it('accepts a confirmation body', () => {
        expect(reservationConfirmationSchema.safeParse(confirmation).success).toBe(true);
    });

    it('rejects an unexpected body', () => {
        expect(
            reservationConfirmationSchema.safeParse({ ...confirmation, items: null }).success,
        ).toBe(false);
        expect(reservationConfirmationSchema.safeParse('ok').success).toBe(false);
    });
});
