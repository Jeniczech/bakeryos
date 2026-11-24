/**
 * Netlify sets `x-nf-client-connection-ip` itself, so it cannot be spoofed there.
 * `x-forwarded-for` is only a fallback for other hosts and local development.
 */
export const getClientIp = (headers: Headers): string =>
    headers.get('x-nf-client-connection-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
