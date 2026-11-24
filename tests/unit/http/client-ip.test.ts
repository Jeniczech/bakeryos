import { describe, expect, it } from 'vitest';
import { getClientIp } from '@/server/http/client-ip';

describe('getClientIp', () => {
    it('prefers the Netlify client IP over x-forwarded-for', () => {
        const headers = new Headers({
            'x-nf-client-connection-ip': '203.0.113.7',
            'x-forwarded-for': '198.51.100.1',
        });

        expect(getClientIp(headers)).toBe('203.0.113.7');
    });

    it('falls back to the last x-forwarded-for entry, which the nearest proxy appended', () => {
        const headers = new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 203.0.113.9 ' });

        expect(getClientIp(headers)).toBe('203.0.113.9');
    });

    it('ignores client-supplied x-forwarded-for entries before the proxy entry', () => {
        const first = new Headers({ 'x-forwarded-for': 'spoofed-1, 203.0.113.9' });
        const second = new Headers({ 'x-forwarded-for': 'spoofed-2, 203.0.113.9' });

        expect(getClientIp(first)).toBe(getClientIp(second));
    });

    it('uses a shared bucket when no IP header is present', () => {
        expect(getClientIp(new Headers())).toBe('unknown');
    });
});
