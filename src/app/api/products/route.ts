import { connection } from 'next/server';
import { errorResponse, NO_STORE_HEADERS } from '@/server/http/problem-details';
import { getAvailableProducts } from '@/server/services/products/get-available-products';

export const GET = async (request: Request): Promise<Response> => {
    // Opts out of prerendering first: Next signals the bail-out by throwing, which the
    // catch below would otherwise turn into a 500.
    await connection();
    try {
        const date = new URL(request.url).searchParams.get('date') ?? '';
        const catalog = await getAvailableProducts(date);
        // Availability changes with every reservation, so it is never cached.
        return Response.json(
            {
                pickupDate: catalog.pickupDate,
                orderingCutoff: catalog.orderingCutoff.toISOString(),
                products: catalog.products,
            },
            { headers: NO_STORE_HEADERS },
        );
    } catch (error) {
        return errorResponse(error, 'GET /api/products');
    }
};
