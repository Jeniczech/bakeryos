import { connection } from 'next/server';
import { checkDatabaseHealth } from '@/server/db/health';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET = async (): Promise<Response> => {
    await connection();

    const health = await checkDatabaseHealth();
    if (!health.ok) {
        console.error('Health check: database unavailable', health.error);
        return Response.json(
            { status: 'error', database: 'unavailable' },
            { status: 503, headers: NO_STORE },
        );
    }

    return Response.json({ status: 'ok', database: 'ok' }, { headers: NO_STORE });
};
