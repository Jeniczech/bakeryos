import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DomainError,
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidRequestError,
    OnlineQuantityLimitError,
    PickupDateUnavailableError,
    ProductUnavailableError,
    ReservationNotFoundError,
    StatusTransitionError,
} from '@/server/domain/errors';
import { errorResponse, mapDomainError, readJsonBody } from '@/server/http/problem-details';

const productId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('mapDomainError', () => {
    it.each<[string, DomainError, number]>([
        ['invalid request', new InvalidRequestError([]), 400],
        ['invalid date', new PickupDateUnavailableError('INVALID_DATE'), 400],
        ['outside window', new PickupDateUnavailableError('OUTSIDE_BOOKING_WINDOW'), 422],
        ['bakery closed', new PickupDateUnavailableError('BAKERY_CLOSED'), 422],
        ['ordering cutoff', new PickupDateUnavailableError('CUTOFF_PASSED'), 409],
        ['quantity limit', new OnlineQuantityLimitError('RESERVATION_LIMIT_EXCEEDED', 50, 51), 422],
        ['product unavailable', new ProductUnavailableError([]), 422],
        ['capacity', new InsufficientCapacityError([]), 409],
        ['idempotency', new IdempotencyConflictError(), 409],
        ['not found', new ReservationNotFoundError(), 404],
        ['pickup date passed', new StatusTransitionError('PICKUP_DATE_PASSED'), 409],
        ['invalid transition', new StatusTransitionError('INVALID_TRANSITION'), 409],
        ['forbidden transition', new StatusTransitionError('FORBIDDEN'), 403],
    ])('maps %s to %i', (_label, error, status) => {
        expect(mapDomainError(error)?.status).toBe(status);
    });
});

describe('errorResponse', () => {
    it('returns Problem Details with the domain code and extension members', async () => {
        const shortages = [{ productId, requested: 2, available: 1 }];

        const response = errorResponse(new InsufficientCapacityError(shortages), 'test');

        expect(response.status).toBe(409);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            type: 'about:blank',
            title: 'Insufficient capacity',
            status: 409,
            detail: 'Some products do not have enough remaining capacity.',
            code: 'INSUFFICIENT_CAPACITY',
            shortages,
        });
    });

    it('hides unexpected errors behind a generic 500', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = errorResponse(new Error('connection refused at 10.0.0.1'), 'test');

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    });

    it('logs only the class and PostgreSQL code of database errors', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const pgError = Object.assign(new Error('Key (idempotency_key)=(secret) already exists'), {
            code: '23505',
            constraint: 'reservations_idempotency_key_unique',
        });
        const wrapped = new Error('Failed query: insert … params: secret', { cause: pgError });

        errorResponse(wrapped, 'test');

        expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
        expect(log.mock.calls[0][1]).toMatchObject({ pgCode: '23505' });
    });

    it('logs a failed query without a PostgreSQL code without its params', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const timeout = new Error('Connection terminated due to connection timeout');
        const failed = new DrizzleQueryError('select … where token_hash = $1', ['secret'], timeout);

        errorResponse(failed, 'test');

        expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
        expect(log.mock.calls[0][1]).toMatchObject({ cause: timeout.message });
    });
});

describe('readJsonBody', () => {
    it('rejects malformed JSON as an invalid request', async () => {
        const request = new Request('http://localhost', { method: 'POST', body: '{oops' });

        await expect(readJsonBody(request)).rejects.toBeInstanceOf(InvalidRequestError);
    });
});
