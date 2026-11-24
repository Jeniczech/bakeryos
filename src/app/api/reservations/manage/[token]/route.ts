import { connection } from 'next/server';
import { errorResponse, NO_STORE_HEADERS } from '@/server/http/problem-details';
import { toReservationDetailsBody } from '@/server/http/reservation-responses';
import { getReservationByToken } from '@/server/services/reservations/get-reservation';

export const GET = async (
    _request: Request,
    context: RouteContext<'/api/reservations/manage/[token]'>,
): Promise<Response> => {
    // Opts out of prerendering first: Next signals the bail-out by throwing, which the
    // catch below would otherwise turn into a 500.
    await connection();
    try {
        const { token } = await context.params;
        const details = await getReservationByToken(token);
        return Response.json(toReservationDetailsBody(details), { headers: NO_STORE_HEADERS });
    } catch (error) {
        // The log context deliberately omits the token.
        return errorResponse(error, 'GET /api/reservations/manage');
    }
};
