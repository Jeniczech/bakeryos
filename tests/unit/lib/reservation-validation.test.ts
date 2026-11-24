import { describe, expect, it } from 'vitest';
import {
    customerNameSchema,
    findOnlineQuantityLimitViolation,
    normalizeItems,
    onlineReservationRequestSchema,
    phoneSchema,
    reservationRequestSchema,
} from '@/lib/validation/reservation';

const productA = '11111111-1111-4111-8111-111111111111';
const productB = '22222222-2222-4222-8222-222222222222';
const productC = '33333333-3333-4333-8333-333333333333';
const productHex = 'abcdef12-3456-4789-8abc-def123456789';

const validRequest = {
    idempotencyKey: 'd6c7c4a8-61e2-4a41-89c7-4d3f61b3a825',
    pickupDate: '2026-11-27',
    customer: { name: '  Jane Doe ', phone: '+420 777-123 456' },
    items: [{ productId: productA, quantity: 2 }],
};

describe('phoneSchema', () => {
    it.each([
        ['+420 777 123 456', '+420777123456'],
        ['777-123-456', '777123456'],
        ['(+420) 777 123 456', '+420777123456'],
        ['123456789', '123456789'],
        ['+123456789012345', '+123456789012345'],
    ])('normalizes %j to %j', (input, expected) => {
        expect(phoneSchema.parse(input)).toBe(expected);
    });

    it.each([
        ['8 digits', '12345678'],
        ['16 digits', '1234567890123456'],
        ['letters', '777 123 abc'],
        ['plus not leading', '420+777123456'],
        ['dots', '777.123.456'],
        ['empty', ''],
    ])('rejects %s', (_label, input) => {
        expect(phoneSchema.safeParse(input).success).toBe(false);
    });
});

describe('customerNameSchema', () => {
    it('trims the name', () => {
        expect(customerNameSchema.parse('  Jane  ')).toBe('Jane');
    });

    it('accepts 1 and 100 characters after trimming', () => {
        expect(customerNameSchema.safeParse('J').success).toBe(true);
        expect(customerNameSchema.safeParse(` ${'a'.repeat(100)} `).success).toBe(true);
    });

    it('rejects blank and over-long names', () => {
        expect(customerNameSchema.safeParse('   ').success).toBe(false);
        expect(customerNameSchema.safeParse('a'.repeat(101)).success).toBe(false);
    });
});

describe('normalizeItems', () => {
    it('merges duplicate products and sorts by product ID', () => {
        expect(
            normalizeItems([
                { productId: productC, quantity: 1 },
                { productId: productA, quantity: 2 },
                { productId: productC, quantity: 4 },
            ]),
        ).toEqual([
            { productId: productA, quantity: 2 },
            { productId: productC, quantity: 5 },
        ]);
    });
});

describe('findOnlineQuantityLimitViolation', () => {
    it('allows 20 units of one product and 50 units in total', () => {
        expect(
            findOnlineQuantityLimitViolation([{ productId: productA, quantity: 20 }]),
        ).toBeNull();
        expect(
            findOnlineQuantityLimitViolation([
                { productId: productA, quantity: 20 },
                { productId: productB, quantity: 20 },
                { productId: productC, quantity: 10 },
            ]),
        ).toBeNull();
    });

    it('rejects 21 units of one product', () => {
        expect(findOnlineQuantityLimitViolation([{ productId: productA, quantity: 21 }])).toEqual({
            reason: 'PRODUCT_LIMIT_EXCEEDED',
            productId: productA,
            quantity: 21,
        });
    });

    it('rejects 51 units in total', () => {
        expect(
            findOnlineQuantityLimitViolation([
                { productId: productA, quantity: 20 },
                { productId: productB, quantity: 20 },
                { productId: productC, quantity: 11 },
            ]),
        ).toEqual({ reason: 'RESERVATION_LIMIT_EXCEEDED', quantity: 51 });
    });
});

describe('reservationRequestSchema', () => {
    it('normalizes customer details and items', () => {
        const parsed = reservationRequestSchema.parse({
            ...validRequest,
            items: [
                { productId: productB, quantity: 1 },
                { productId: productA, quantity: 1 },
                { productId: productB, quantity: 2 },
            ],
        });
        expect(parsed.customer).toEqual({ name: 'Jane Doe', phone: '+420777123456' });
        expect(parsed.items).toEqual([
            { productId: productA, quantity: 1 },
            { productId: productB, quantity: 3 },
        ]);
    });

    it('lowercases UUIDs so differently cased duplicates merge', () => {
        const parsed = reservationRequestSchema.parse({
            ...validRequest,
            idempotencyKey: validRequest.idempotencyKey.toUpperCase(),
            items: [
                { productId: productHex.toUpperCase(), quantity: 2 },
                { productId: productHex, quantity: 3 },
            ],
        });
        expect(parsed.idempotencyKey).toBe(validRequest.idempotencyKey);
        expect(parsed.items).toEqual([{ productId: productHex, quantity: 5 }]);
    });

    it('accepts up to 100 items and rejects more', () => {
        const items = (count: number) =>
            Array.from({ length: count }, () => ({ productId: productA, quantity: 1 }));
        expect(
            reservationRequestSchema.safeParse({ ...validRequest, items: items(100) }).success,
        ).toBe(true);
        expect(
            reservationRequestSchema.safeParse({ ...validRequest, items: items(101) }).success,
        ).toBe(false);
    });

    it('does not apply online limits', () => {
        const result = reservationRequestSchema.safeParse({
            ...validRequest,
            items: [{ productId: productA, quantity: 100 }],
        });
        expect(result.success).toBe(true);
    });

    it.each([
        ['an invalid idempotency key', { idempotencyKey: 'not-a-uuid' }],
        ['an invalid date', { pickupDate: '2026-02-30' }],
        ['an empty cart', { items: [] }],
        ['a zero quantity', { items: [{ productId: productA, quantity: 0 }] }],
        ['a fractional quantity', { items: [{ productId: productA, quantity: 1.5 }] }],
        ['an invalid product ID', { items: [{ productId: 'bread', quantity: 1 }] }],
    ])('rejects %s', (_label, override) => {
        expect(reservationRequestSchema.safeParse({ ...validRequest, ...override }).success).toBe(
            false,
        );
    });
});

describe('onlineReservationRequestSchema', () => {
    it('accepts a request within the limits', () => {
        expect(onlineReservationRequestSchema.safeParse(validRequest).success).toBe(true);
    });

    it('applies the per-product limit after merging duplicates', () => {
        const result = onlineReservationRequestSchema.safeParse({
            ...validRequest,
            items: [
                { productId: productA, quantity: 15 },
                { productId: productA, quantity: 6 },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('applies the per-product limit across differently cased product IDs', () => {
        const result = onlineReservationRequestSchema.safeParse({
            ...validRequest,
            items: [
                { productId: productHex, quantity: 20 },
                { productId: productHex.toUpperCase(), quantity: 20 },
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects more than 50 units in total', () => {
        const result = onlineReservationRequestSchema.safeParse({
            ...validRequest,
            items: [
                { productId: productA, quantity: 20 },
                { productId: productB, quantity: 20 },
                { productId: productC, quantity: 11 },
            ],
        });
        expect(result.success).toBe(false);
    });
});
