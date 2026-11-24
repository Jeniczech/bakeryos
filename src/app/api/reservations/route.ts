import { reservationRequestSchema } from '@/lib/validation/reservation';
import { InvalidRequestError, toValidationIssues } from '@/server/domain/errors';
import { getClientIp } from '@/server/http/client-ip';
import {
    errorResponse,
    NO_STORE_HEADERS,
    problemResponse,
    readJsonBody,
} from '@/server/http/problem-details';
import { toConfirmationBody } from '@/server/http/reservation-responses';
import { consumeRateLimit, RESERVATION_RATE_LIMIT } from '@/server/services/rate-limit';
import { createReservation } from '@/server/services/reservations/create-reservation';

export const POST = async (request: Request): Promise<Response> => {
    try {
        // Before parsing, so malformed requests and replays count toward the limit too.
        const rateLimit = await consumeRateLimit(
            `reservations:${getClientIp(request.headers)}`,
            RESERVATION_RATE_LIMIT,
        );
        if (!rateLimit.allowed) {
            return problemResponse(
                {
                    status: 429,
                    title: 'Too many requests',
                    code: 'RATE_LIMITED',
                    detail: 'Too many reservation attempts. Please try again later.',
                },
                { 'Retry-After': String(rateLimit.retryAfterSeconds) },
            );
        }

        // Unknown fields such as a client-supplied `source` are stripped here.
        const parsed = reservationRequestSchema.safeParse(await readJsonBody(request));
        if (!parsed.success) {
            throw new InvalidRequestError(
                toValidationIssues(parsed.error),
                'The reservation request is invalid.',
            );
        }
        const result = await createReservation({ ...parsed.data, source: 'online' });
        return Response.json(toConfirmationBody(result, new URL(request.url).origin), {
            status: result.replayed ? 200 : 201,
            headers: NO_STORE_HEADERS,
        });
    } catch (error) {
        return errorResponse(error, 'POST /api/reservations');
    }
};
