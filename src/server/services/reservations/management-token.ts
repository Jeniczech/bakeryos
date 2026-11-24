import { createHash, createHmac } from 'node:crypto';

// Domain separation keeps these HMACs distinct from any other use of the same secret.
const TOKEN_CONTEXT = 'bakeryos:management-token:v1:';
const MIN_SECRET_LENGTH = 32;

export const getManagementTokenSecret = (): string => {
    const secret = process.env.MANAGEMENT_TOKEN_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `MANAGEMENT_TOKEN_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`,
        );
    }
    return secret;
};

/**
 * Deterministic, so an idempotent replay can return the same management link without the
 * plaintext token ever being stored. The token is a bearer credential: never log it.
 */
export const deriveManagementToken = (
    reservationId: string,
    secret: string = getManagementTokenSecret(),
): string =>
    createHmac('sha256', secret)
        .update(TOKEN_CONTEXT + reservationId.toLowerCase())
        .digest('base64url');

/** Only this hash is stored, in `reservations.management_token_hash`. */
export const hashManagementToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

// A base64url-encoded SHA-256 HMAC is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Lets callers reject malformed tokens without a database lookup. */
export const isWellFormedManagementToken = (token: string): boolean => TOKEN_PATTERN.test(token);
