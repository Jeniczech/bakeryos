import { errorResponse, NO_STORE_HEADERS } from '@/server/http/problem-details';
import { toReservationDetailsBody } from '@/server/http/reservation-responses';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';

export const POST = async (
    _request: Request,
    context: RouteContext<'/api/reservations/manage/[token]/cancel'>,
): Promise<Response> => {
    try {
        const { token } = await context.params;
        const details = await cancelReservation({ actor: 'customer', token });
        return Response.json(toReservationDetailsBody(details), { headers: NO_STORE_HEADERS });
    } catch (error) {
        // The log context deliberately omits the token.
        return errorResponse(error, 'POST /api/reservations/manage/cancel');
    }
};
