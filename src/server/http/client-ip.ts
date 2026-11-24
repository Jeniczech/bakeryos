/**
 * Netlify sets `x-nf-client-connection-ip` itself, so it cannot be spoofed there. Elsewhere
 * the last `x-forwarded-for` entry is used: it is the one appended by the nearest proxy,
 * while earlier entries come from the client. Without either header every request shares
 * the `unknown` bucket, which fails closed instead of skipping the limit.
 */
export const getClientIp = (headers: Headers): string =>
    headers.get('x-nf-client-connection-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    'unknown';
