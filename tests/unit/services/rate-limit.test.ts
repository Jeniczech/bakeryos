import { describe, expect, it } from 'vitest';
import { getRetryAfterSeconds, getWindowStart } from '@/server/services/rate-limit';

const TEN_MINUTES = 10 * 60_000;

describe('getWindowStart', () => {
    it('aligns windows to fixed boundaries', () => {
        expect(getWindowStart(new Date('2026-11-24T10:17:42Z'), TEN_MINUTES)).toEqual(
            new Date('2026-11-24T10:10:00Z'),
        );
        expect(getWindowStart(new Date('2026-11-24T10:20:00Z'), TEN_MINUTES)).toEqual(
            new Date('2026-11-24T10:20:00Z'),
        );
    });
});

describe('getRetryAfterSeconds', () => {
    const windowStart = new Date('2026-11-24T10:10:00Z');

    it('rounds the time left in the window up to whole seconds', () => {
        expect(
            getRetryAfterSeconds(new Date('2026-11-24T10:17:42.300Z'), windowStart, TEN_MINUTES),
        ).toBe(138);
    });

    it('never returns less than one second', () => {
        expect(
            getRetryAfterSeconds(new Date('2026-11-24T10:19:59.999Z'), windowStart, TEN_MINUTES),
        ).toBe(1);
    });
});
