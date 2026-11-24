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

    it('falls back to the first x-forwarded-for entry', () => {
        const headers = new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' });

        expect(getClientIp(headers)).toBe('198.51.100.1');
    });

    it('uses a shared bucket when no IP header is present', () => {
        expect(getClientIp(new Headers())).toBe('unknown');
    });
});
