// TEMPORARY Stage 1 deployment spike. Remove after validating Netlify/Neon assumptions.
import { hash, verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';

type ClaimResult = 'claimed' | 'sold_out' | `error: ${string}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const setupSpike = async (units: number): Promise<void> => {
    const db = getDb();
    await db.execute(sql`
        create table if not exists spike_stock (id int primary key, remaining int not null)
    `);
    await db.execute(sql`
        create table if not exists spike_claims (id serial primary key, created_at timestamptz not null default now())
    `);
    await db.execute(sql`truncate spike_claims`);
    await db.execute(sql`
        insert into spike_stock (id, remaining) values (1, ${units})
        on conflict (id) do update set remaining = excluded.remaining
    `);
};

// Reads the stock, waits, then writes back an absolute value. Without FOR UPDATE this
// produces lost updates under concurrency; with FOR UPDATE transactions must serialize.
export const claimUnit = async (useLock: boolean, delayMs: number): Promise<ClaimResult> => {
    try {
        return await getDb().transaction(async (tx) => {
            const lockClause = useLock ? sql`for update` : sql``;
            const result = await tx.execute<{ remaining: number }>(
                sql`select remaining from spike_stock where id = 1 ${lockClause}`,
            );
            const remaining = result.rows[0]?.remaining ?? 0;
            await sleep(delayMs);
            if (remaining < 1) {
                return 'sold_out';
            }
            await tx.execute(sql`update spike_stock set remaining = ${remaining - 1} where id = 1`);
            await tx.execute(sql`insert into spike_claims default values`);
            return 'claimed';
        });
    } catch (error) {
        return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
};

export const getSpikeState = async (): Promise<{ remaining: number; claims: number }> => {
    const result = await getDb().execute<{ remaining: number; claims: number }>(sql`
        select (select remaining from spike_stock where id = 1) as remaining,
               (select count(*)::int from spike_claims) as claims
    `);
    const row = result.rows[0];
    return { remaining: row?.remaining ?? 0, claims: row?.claims ?? 0 };
};

export const runConcurrentClaims = async (
    concurrency: number,
    units: number,
    useLock: boolean,
    delayMs: number,
) => {
    await setupSpike(units);
    const results = await Promise.all(
        Array.from({ length: concurrency }, () => claimUnit(useLock, delayMs)),
    );
    return { useLock, concurrency, units, results, final: await getSpikeState() };
};

export const teardownSpike = async (): Promise<void> => {
    await getDb().execute(sql`drop table if exists spike_claims, spike_stock`);
};

export const runArgon2Check = async () => {
    const password = 'spike-password-123';
    const hashStart = performance.now();
    const passwordHash = await hash(password);
    const hashMs = performance.now() - hashStart;
    const verifyStart = performance.now();
    const correct = await verify(passwordHash, password);
    const verifyMs = performance.now() - verifyStart;
    const wrong = await verify(passwordHash, 'wrong-password');
    return {
        params: passwordHash.split('$').slice(1, 4).join('$'),
        correct,
        wrong,
        hashMs: Math.round(hashMs),
        verifyMs: Math.round(verifyMs),
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
    };
};
