import { lt, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';

export type RateLimitPolicy = { limit: number; windowMs: number };

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** TDD §11: 10 reservation requests per IP per 10 minutes; replays count too. */
export const RESERVATION_RATE_LIMIT: RateLimitPolicy = { limit: 10, windowMs: 10 * 60_000 };

// Longer than any policy window, so cleanup never deletes a window that is still counting.
const EXPIRED_WINDOW_AGE_MS = 24 * 60 * 60_000;

/** Fixed windows aligned to the epoch, so every instance agrees on the boundaries. */
export const getWindowStart = (now: Date, windowMs: number): Date =>
    new Date(Math.floor(now.getTime() / windowMs) * windowMs);

/** Whole seconds until the window ends, at least 1, for the `Retry-After` header. */
export const getRetryAfterSeconds = (now: Date, windowStart: Date, windowMs: number): number =>
    Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));

/**
 * Counts one attempt for `key` with a single atomic upsert (TDD §5.6.1), so concurrent
 * requests on any serverless instance are counted exactly. Runs outside any business
 * transaction. The first attempt in a window also deletes long-expired windows.
 */
export const consumeRateLimit = async (
    key: string,
    policy: RateLimitPolicy,
    options: { now?: Date } = {},
): Promise<RateLimitResult> => {
    const now = options.now ?? new Date();
    const windowStart = getWindowStart(now, policy.windowMs);
    const [{ count }] = await getDb()
        .insert(rateLimits)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({
            target: [rateLimits.key, rateLimits.windowStart],
            set: { count: sql`${rateLimits.count} + 1` },
        })
        .returning({ count: rateLimits.count });
    if (count === 1) {
        await getDb()
            .delete(rateLimits)
            .where(lt(rateLimits.windowStart, new Date(now.getTime() - EXPIRED_WINDOW_AGE_MS)));
    }
    if (count > policy.limit) {
        return {
            allowed: false,
            retryAfterSeconds: getRetryAfterSeconds(now, windowStart, policy.windowMs),
        };
    }
    return { allowed: true };
};
