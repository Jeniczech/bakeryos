import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { adminUsers } from '@/server/db/schema';
import { consumeRateLimit, LOGIN_RATE_LIMIT } from '@/server/services/rate-limit';
import { hashPassword, verifyPassword } from './password';

// Bounds the Argon2 work an attacker can request per attempt.
const PASSWORD_MAX_LENGTH = 256;

const credentialsSchema = z.object({
    email: z.email().max(254),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type AuthenticatedAdmin = { id: string; email: string };

export type AdminAuthenticationResult =
    | { ok: true; admin: AuthenticatedAdmin }
    | { ok: false; reason: 'INVALID_CREDENTIALS' }
    | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

const normalizeEmail = (email: unknown): string =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

/** TDD §5.6.1: the key must not contain the raw email. */
export const getLoginRateLimitKey = (clientIp: string, normalizedEmail: string): string =>
    `login:${clientIp}:${createHash('sha256').update(normalizedEmail).digest('hex')}`;

// An unknown email is still checked against a hash, so response time does not reveal
// whether the account exists.
let dummyPasswordHash: Promise<string> | undefined;
const getDummyPasswordHash = (): Promise<string> => {
    dummyPasswordHash ??= hashPassword(randomBytes(32).toString('base64'));
    return dummyPasswordHash;
};

/**
 * Checks administrator credentials. Every attempt counts toward the login rate limit, including
 * malformed and successful ones, before anything else is checked. Failures never say whether
 * the email exists.
 */
export const authenticateAdmin = async (
    credentials: Partial<Record<string, unknown>>,
    context: { clientIp: string; now?: Date },
): Promise<AdminAuthenticationResult> => {
    const email = normalizeEmail(credentials.email);
    const rateLimit = await consumeRateLimit(
        getLoginRateLimitKey(context.clientIp, email),
        LOGIN_RATE_LIMIT,
        { now: context.now },
    );
    if (!rateLimit.allowed) {
        return {
            ok: false,
            reason: 'RATE_LIMITED',
            retryAfterSeconds: rateLimit.retryAfterSeconds,
        };
    }

    const parsed = credentialsSchema.safeParse({ email, password: credentials.password });
    if (!parsed.success) {
        return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }

    const [admin] = await getDb()
        .select({
            id: adminUsers.id,
            email: adminUsers.email,
            passwordHash: adminUsers.passwordHash,
        })
        .from(adminUsers)
        .where(eq(adminUsers.email, parsed.data.email));
    const passwordMatches = await verifyPassword(
        admin?.passwordHash ?? (await getDummyPasswordHash()),
        parsed.data.password,
    );
    if (!admin || !passwordMatches) {
        return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }
    return { ok: true, admin: { id: admin.id, email: admin.email } };
};
