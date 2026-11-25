import { DrizzleQueryError } from 'drizzle-orm/errors';
import { findPgError } from '@/server/db/errors';
import {
    DomainError,
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidRequestError,
    OnlineQuantityLimitError,
    PickupDateUnavailableError,
    PlanBelowCommitmentsError,
    ProductNotFoundError,
    ProductUnavailableError,
    ReservationNotFoundError,
    StatusTransitionError,
} from '@/server/domain/errors';

/** Private reservation data and management links must never be cached. */
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

export type Problem = {
    status: number;
    title: string;
    extensions?: Record<string, unknown>;
};

/** RFC 9457 body with a stable `code` the client can branch on. */
export const problemResponse = (
    problem: Problem & { code: string; detail: string },
    headers: Record<string, string> = {},
): Response =>
    Response.json(
        {
            type: 'about:blank',
            title: problem.title,
            status: problem.status,
            detail: problem.detail,
            code: problem.code,
            ...problem.extensions,
        },
        {
            status: problem.status,
            headers: {
                'Content-Type': 'application/problem+json',
                ...NO_STORE_HEADERS,
                ...headers,
            },
        },
    );

/** Status conventions from TDD §8; null for a domain error with no HTTP meaning yet. */
export const mapDomainError = (error: DomainError): Problem | null => {
    if (error instanceof InvalidRequestError) {
        return { status: 400, title: 'Invalid request', extensions: { errors: error.issues } };
    }
    if (error instanceof PickupDateUnavailableError) {
        const status =
            error.code === 'INVALID_DATE' ? 400 : error.code === 'CUTOFF_PASSED' ? 409 : 422;
        return { status, title: 'Pickup date unavailable' };
    }
    if (error instanceof OnlineQuantityLimitError) {
        return {
            status: 422,
            title: 'Order limit exceeded',
            extensions: {
                limit: error.limit,
                requested: error.requested,
                productId: error.productId,
            },
        };
    }
    if (error instanceof ProductUnavailableError) {
        return {
            status: 422,
            title: 'Product unavailable',
            extensions: { products: error.products },
        };
    }
    if (error instanceof InsufficientCapacityError) {
        return {
            status: 409,
            title: 'Insufficient capacity',
            extensions: { shortages: error.shortages },
        };
    }
    if (error instanceof IdempotencyConflictError) {
        return { status: 409, title: 'Idempotency key reused' };
    }
    if (error instanceof ReservationNotFoundError) {
        return { status: 404, title: 'Reservation not found' };
    }
    if (error instanceof StatusTransitionError) {
        return {
            status: error.code === 'FORBIDDEN' ? 403 : 409,
            title: 'Reservation cannot be changed',
        };
    }
    if (error instanceof ProductNotFoundError) {
        return { status: 404, title: 'Product not found' };
    }
    if (error instanceof PlanBelowCommitmentsError) {
        return { status: 409, title: 'Capacity below commitments' };
    }
    return null;
};

/**
 * Database error messages can carry query parameters (idempotency keys, token hashes), so
 * only the error class and PostgreSQL code, or the underlying cause, are logged for them.
 */
export const describeForLog = (error: unknown): unknown => {
    const pgError = findPgError(error);
    if (pgError) {
        return {
            name: error instanceof Error ? error.name : typeof error,
            pgCode: pgError.code,
            constraint: pgError.constraint,
        };
    }
    // A failed query without a PostgreSQL code (e.g. a connection timeout) still lists its params.
    if (error instanceof DrizzleQueryError) {
        return { name: error.name, cause: error.cause?.message };
    }
    return error;
};

/** Never exposes SQL details or stack traces; unexpected errors become a generic 500. */
export const errorResponse = (error: unknown, context: string): Response => {
    if (error instanceof DomainError) {
        const problem = mapDomainError(error);
        if (problem) {
            return problemResponse({ ...problem, code: error.code, detail: error.message });
        }
    }
    console.error(`${context}: unexpected error`, describeForLog(error));
    return problemResponse({
        status: 500,
        title: 'Internal server error',
        code: 'INTERNAL_ERROR',
        detail: 'Something went wrong. Please try again.',
    });
};

/** Reads a JSON body, rejecting malformed JSON as an invalid request. */
export const readJsonBody = async (request: Request): Promise<unknown> => {
    try {
        return await request.json();
    } catch {
        throw new InvalidRequestError([], 'The request body must be valid JSON.');
    }
};
