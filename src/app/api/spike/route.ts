// TEMPORARY Stage 1 deployment spike. Remove after validating Netlify/Neon assumptions.
import { connection, type NextRequest } from 'next/server';
import {
    claimUnit,
    getSpikeState,
    runArgon2Check,
    runConcurrentClaims,
    setupSpike,
    teardownSpike,
} from '@/server/spike/deployment-spike';

const NO_STORE = { 'Cache-Control': 'no-store' };

const intParam = (params: URLSearchParams, name: string, fallback: number, max: number): number => {
    const value = Number(params.get(name) ?? fallback);
    return Number.isInteger(value) && value >= 0 && value <= max ? value : fallback;
};

export const GET = async (request: NextRequest): Promise<Response> => {
    await connection();

    const secret = process.env.SPIKE_SECRET;
    if (!secret || request.headers.get('x-spike-secret') !== secret) {
        return Response.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
    }

    const params = request.nextUrl.searchParams;
    const useLock = params.get('lock') !== '0';
    const delayMs = intParam(params, 'delayMs', 200, 2000);
    const units = intParam(params, 'units', 1, 100);

    switch (params.get('action')) {
        case 'setup':
            await setupSpike(units);
            return Response.json(await getSpikeState(), { headers: NO_STORE });
        case 'claim':
            return Response.json(
                { result: await claimUnit(useLock, delayMs) },
                { headers: NO_STORE },
            );
        case 'state':
            return Response.json(await getSpikeState(), { headers: NO_STORE });
        case 'concurrent': {
            const concurrency = intParam(params, 'n', 5, 20);
            return Response.json(await runConcurrentClaims(concurrency, units, useLock, delayMs), {
                headers: NO_STORE,
            });
        }
        case 'argon2':
            return Response.json(await runArgon2Check(), { headers: NO_STORE });
        case 'teardown':
            await teardownSpike();
            return Response.json({ ok: true }, { headers: NO_STORE });
        default:
            return Response.json({ error: 'unknown action' }, { status: 400, headers: NO_STORE });
    }
};
