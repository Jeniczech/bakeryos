import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reservationRequestSchema } from '@/lib/validation/reservation';
import {
    deriveManagementToken,
    getManagementTokenSecret,
    hashManagementToken,
} from '@/server/services/reservations/management-token';
import { computeRequestHash } from '@/server/services/reservations/request-hash';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const reservationId = '0b6c7c55-1a2b-4c3d-8e4f-000000000abc';
const productA = '11111111-1111-4111-8111-111111111111';
const productB = '22222222-2222-4222-8222-222222222222';

describe('management tokens', () => {
    it('derives the same URL-safe token for the same reservation and secret', () => {
        const token = deriveManagementToken(reservationId, SECRET);
        expect(deriveManagementToken(reservationId, SECRET)).toBe(token);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('treats UUID case variants as the same reservation', () => {
        expect(deriveManagementToken(reservationId.toUpperCase(), SECRET)).toBe(
            deriveManagementToken(reservationId, SECRET),
        );
    });

    it('differs per reservation and per secret', () => {
        const token = deriveManagementToken(reservationId, SECRET);
        expect(deriveManagementToken('0b6c7c55-1a2b-4c3d-8e4f-000000000abd', SECRET)).not.toBe(
            token,
        );
        expect(deriveManagementToken(reservationId, `${SECRET}-other`)).not.toBe(token);
    });

    it('is not a bare HMAC of the reservation ID (domain separation)', () => {
        const bare = createHmac('sha256', SECRET).update(reservationId).digest('base64url');
        expect(deriveManagementToken(reservationId, SECRET)).not.toBe(bare);
    });

    it('stores a SHA-256 hex hash, not the token', () => {
        const token = deriveManagementToken(reservationId, SECRET);
        const hash = hashManagementToken(token);
        expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
        expect(hash).not.toContain(token);
    });

    it('requires a sufficiently long secret', () => {
        const original = process.env.MANAGEMENT_TOKEN_SECRET;
        try {
            process.env.MANAGEMENT_TOKEN_SECRET = 'too-short';
            expect(() => getManagementTokenSecret()).toThrow(/MANAGEMENT_TOKEN_SECRET/);
            delete process.env.MANAGEMENT_TOKEN_SECRET;
            expect(() => getManagementTokenSecret()).toThrow(/MANAGEMENT_TOKEN_SECRET/);
            process.env.MANAGEMENT_TOKEN_SECRET = SECRET;
            expect(getManagementTokenSecret()).toBe(SECRET);
        } finally {
            if (original === undefined) {
                delete process.env.MANAGEMENT_TOKEN_SECRET;
            } else {
                process.env.MANAGEMENT_TOKEN_SECRET = original;
            }
        }
    });
});

describe('computeRequestHash', () => {
    const parse = (overrides: Record<string, unknown> = {}) =>
        reservationRequestSchema.parse({
            idempotencyKey: 'd6c7c4a8-61e2-4a41-89c7-4d3f61b3a825',
            pickupDate: '2026-11-27',
            customer: { name: 'Jane Doe', phone: '+420777123456' },
            items: [
                { productId: productA, quantity: 2 },
                { productId: productB, quantity: 1 },
            ],
            ...overrides,
        });

    it('is equal for requests that normalize to the same payload', () => {
        const equivalent = parse({
            idempotencyKey: 'aaaaaaaa-61e2-4a41-89c7-4d3f61b3a825',
            customer: { name: '  Jane Doe ', phone: '+420 777-123 456' },
            items: [
                { productId: productB.toUpperCase(), quantity: 1 },
                { productId: productA, quantity: 1 },
                { productId: productA, quantity: 1 },
            ],
        });
        expect(computeRequestHash(equivalent, 'online')).toBe(
            computeRequestHash(parse(), 'online'),
        );
    });

    it('changes with the source and with every payload field', () => {
        const base = computeRequestHash(parse(), 'online');
        expect(computeRequestHash(parse(), 'admin')).not.toBe(base);
        expect(computeRequestHash(parse({ pickupDate: '2026-11-28' }), 'online')).not.toBe(base);
        expect(
            computeRequestHash(
                parse({ customer: { name: 'Jane Doe', phone: '+420777123457' } }),
                'online',
            ),
        ).not.toBe(base);
        expect(
            computeRequestHash(
                parse({ customer: { name: 'John Doe', phone: '+420777123456' } }),
                'online',
            ),
        ).not.toBe(base);
        expect(
            computeRequestHash(parse({ items: [{ productId: productA, quantity: 3 }] }), 'online'),
        ).not.toBe(base);
    });
});
