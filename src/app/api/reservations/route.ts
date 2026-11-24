import { getClientIp } from '@/server/http/client-ip';
import {
    errorResponse,
    NO_STORE_HEADERS,
    problemResponse,
    readJsonBody,
} from '@/server/http/problem-details';
import { getPublicOrigin } from '@/server/http/public-origin';
import { toConfirmationBody } from '@/server/http/reservation-responses';
import { consumeRateLimit, RESERVATION_RATE_LIMIT } from '@/server/services/rate-limit';
import { createOnlineReservation } from '@/server/services/reservations/create-reservation';

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

        const result = await createOnlineReservation(await readJsonBody(request));
        return Response.json(toConfirmationBody(result, getPublicOrigin(request)), {
            status: result.replayed ? 200 : 201,
            headers: NO_STORE_HEADERS,
        });
    } catch (error) {
        return errorResponse(error, 'POST /api/reservations');
    }
};
