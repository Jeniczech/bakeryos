import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';
import {
    consumeRateLimit,
    getWindowStart,
    type RateLimitPolicy,
} from '@/server/services/rate-limit';

const KEY_PREFIX = 'rate-limit-test:';
const POLICY: RateLimitPolicy = { limit: 3, windowMs: 60_000 };
// Near the real clock: cleanup is global, and a far-future clock would delete rows that
// other test files are still counting.
const WINDOW_START = getWindowStart(new Date(), POLICY.windowMs);
const IN_WINDOW = new Date(WINDOW_START.getTime() + 15_200);

const newKey = () => `${KEY_PREFIX}${randomUUID()}`;

const readCount = async (key: string, windowStart: Date) => {
    const [row] = await getDb()
        .select({ count: rateLimits.count })
        .from(rateLimits)
        .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart)));
    return row?.count;
};

afterEach(async () => {
    await getDb()
        .delete(rateLimits)
        .where(like(rateLimits.key, `${KEY_PREFIX}%`));
});

afterAll(async () => {
    await closeDb();
});

describe('consumeRateLimit', () => {
    it('allows up to the limit, then refuses with the seconds left in the window', async () => {
        const key = newKey();
        const results = [];
        for (let attempt = 0; attempt < 5; attempt++) {
            results.push(await consumeRateLimit(key, POLICY, { now: IN_WINDOW }));
        }

        expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
        expect(results[3]).toEqual({ allowed: false, retryAfterSeconds: 45 });
        expect(await readCount(key, WINDOW_START)).toBe(5);
    });

    it('starts counting again in the next window', async () => {
        const key = newKey();
        for (let attempt = 0; attempt < 4; attempt++) {
            await consumeRateLimit(key, POLICY, { now: IN_WINDOW });
        }

        const nextWindow = new Date(WINDOW_START.getTime() + POLICY.windowMs);
        await expect(consumeRateLimit(key, POLICY, { now: nextWindow })).resolves.toEqual({
            allowed: true,
        });
    });

    it('keeps separate counts per key', async () => {
        const [first, second] = [newKey(), newKey()];
        for (let attempt = 0; attempt < 4; attempt++) {
            await consumeRateLimit(first, POLICY, { now: IN_WINDOW });
        }

        await expect(consumeRateLimit(second, POLICY, { now: IN_WINDOW })).resolves.toEqual({
            allowed: true,
        });
    });

    it('counts concurrent attempts exactly', async () => {
        const key = newKey();

        const results = await Promise.all(
            Array.from({ length: 20 }, () => consumeRateLimit(key, POLICY, { now: IN_WINDOW })),
        );

        expect(results.filter((result) => result.allowed)).toHaveLength(POLICY.limit);
        expect(await readCount(key, WINDOW_START)).toBe(20);
    });

    it('deletes long-expired windows when a new window starts', async () => {
        const staleKey = newKey();
        const staleWindow = new Date(WINDOW_START.getTime() - 2 * 24 * 60 * 60_000);
        await getDb()
            .insert(rateLimits)
            .values({ key: staleKey, windowStart: staleWindow, count: 7 });
        const recentKey = newKey();
        const recentWindow = new Date(WINDOW_START.getTime() - POLICY.windowMs);
        await getDb()
            .insert(rateLimits)
            .values({ key: recentKey, windowStart: recentWindow, count: 2 });

        await consumeRateLimit(newKey(), POLICY, { now: IN_WINDOW });

        expect(await readCount(staleKey, staleWindow)).toBeUndefined();
        expect(await readCount(recentKey, recentWindow)).toBe(2);
    });
});
