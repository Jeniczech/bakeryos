import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { authenticateAdmin, getLoginRateLimitKey } from '@/server/auth/authenticate-admin';
import { hashPassword } from '@/server/auth/password';
import { closeDb, getDb } from '@/server/db/client';
import { adminUsers, rateLimits } from '@/server/db/schema';
import { LOGIN_RATE_LIMIT } from '@/server/services/rate-limit';

const IP_PREFIX = 'authenticate-admin-test-';
const EMAIL = `admin-${randomUUID()}@bakeryos.test`;
const PASSWORD = 'correct horse battery staple';

// One clock for the whole file, so no test straddles a rate-limit window boundary.
const NOW = new Date();

let adminId: string;

// A fresh client IP per test keeps rate-limit counters independent.
const newClientIp = () => `${IP_PREFIX}${randomUUID()}`;

beforeAll(async () => {
    const [admin] = await getDb()
        .insert(adminUsers)
        .values({ email: EMAIL, passwordHash: await hashPassword(PASSWORD) })
        .returning({ id: adminUsers.id });
    adminId = admin.id;
});

afterEach(async () => {
    await getDb()
        .delete(rateLimits)
        .where(like(rateLimits.key, `login:${IP_PREFIX}%`));
});

afterAll(async () => {
    await getDb().delete(adminUsers).where(eq(adminUsers.id, adminId));
    await closeDb();
});

describe('authenticateAdmin', () => {
    it('returns the administrator for correct credentials, ignoring email case and spaces', async () => {
        const result = await authenticateAdmin(
            { email: `  ${EMAIL.toUpperCase()} `, password: PASSWORD },
            { clientIp: newClientIp(), now: NOW },
        );

        expect(result).toEqual({ ok: true, admin: { id: adminId, email: EMAIL } });
    });

    it('rejects a wrong password', async () => {
        const result = await authenticateAdmin(
            { email: EMAIL, password: 'wrong password' },
            { clientIp: newClientIp(), now: NOW },
        );

        expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
    });

    it('rejects an unknown email with the same result as a wrong password', async () => {
        const result = await authenticateAdmin(
            { email: `unknown-${randomUUID()}@bakeryos.test`, password: PASSWORD },
            { clientIp: newClientIp(), now: NOW },
        );

        expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
    });

    it('rejects malformed credentials', async () => {
        const clientIp = newClientIp();

        await expect(
            authenticateAdmin(
                { email: 'not-an-email', password: PASSWORD },
                { clientIp, now: NOW },
            ),
        ).resolves.toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
        await expect(authenticateAdmin({}, { clientIp, now: NOW })).resolves.toEqual({
            ok: false,
            reason: 'INVALID_CREDENTIALS',
        });
    });

    it('refuses even correct credentials once the limit is used up, counting every attempt', async () => {
        const clientIp = newClientIp();
        await authenticateAdmin({ email: EMAIL, password: PASSWORD }, { clientIp, now: NOW });
        for (let attempt = 1; attempt < LOGIN_RATE_LIMIT.limit; attempt++) {
            await authenticateAdmin(
                { email: EMAIL, password: 'wrong password' },
                { clientIp, now: NOW },
            );
        }

        const result = await authenticateAdmin(
            { email: EMAIL, password: PASSWORD },
            { clientIp, now: NOW },
        );

        expect(result).toMatchObject({ ok: false, reason: 'RATE_LIMITED' });
        if (!result.ok && result.reason === 'RATE_LIMITED') {
            expect(result.retryAfterSeconds).toBeGreaterThan(0);
            expect(result.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.windowMs / 1000);
        }
    });

    it('limits per IP and email, keyed by an email hash instead of the raw email', async () => {
        const clientIp = newClientIp();
        for (let attempt = 0; attempt < LOGIN_RATE_LIMIT.limit; attempt++) {
            await authenticateAdmin(
                { email: EMAIL, password: 'wrong password' },
                { clientIp, now: NOW },
            );
        }

        await expect(
            authenticateAdmin(
                { email: EMAIL, password: PASSWORD },
                { clientIp: newClientIp(), now: NOW },
            ),
        ).resolves.toMatchObject({ ok: true });
        await expect(
            authenticateAdmin(
                { email: `other-${randomUUID()}@bakeryos.test`, password: PASSWORD },
                { clientIp, now: NOW },
            ),
        ).resolves.toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });

        const rows = await getDb()
            .select({ key: rateLimits.key, count: rateLimits.count })
            .from(rateLimits)
            .where(eq(rateLimits.key, getLoginRateLimitKey(clientIp, EMAIL)));
        expect(rows).toEqual([
            { key: getLoginRateLimitKey(clientIp, EMAIL), count: LOGIN_RATE_LIMIT.limit },
        ]);
        expect(rows[0].key).not.toContain(EMAIL);
    });
});
