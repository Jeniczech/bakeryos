import { describe, expect, it } from 'vitest';
import {
    addDays,
    getPragueDate,
    getWeekday,
    isValidCalendarDate,
    pragueTimeToInstant,
} from '@/lib/date-time/prague';

describe('isValidCalendarDate', () => {
    it.each(['2026-11-24', '2028-02-29', '2026-12-31'])('accepts %s', (value) => {
        expect(isValidCalendarDate(value)).toBe(true);
    });

    it.each(['2026-02-29', '2026-13-01', '2026-11-31', '2026-1-01', '26-11-24', '', 'tomorrow'])(
        'rejects %j',
        (value) => {
            expect(isValidCalendarDate(value)).toBe(false);
        },
    );
});

describe('addDays', () => {
    it('crosses month, year, and leap-day boundaries', () => {
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('is unaffected by daylight-saving transitions', () => {
        expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
        expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
        expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    });

    it('throws for an invalid date', () => {
        expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    });
});

describe('getWeekday', () => {
    it('uses 0 for Sunday through 6 for Saturday', () => {
        expect(getWeekday('2026-11-22')).toBe(0);
        expect(getWeekday('2026-11-23')).toBe(1);
        expect(getWeekday('2026-11-28')).toBe(6);
    });
});

describe('getPragueDate', () => {
    it('uses the Prague calendar date, not the UTC date', () => {
        expect(getPragueDate(new Date('2026-11-24T22:59:59Z'))).toBe('2026-11-24');
        expect(getPragueDate(new Date('2026-11-24T23:00:00Z'))).toBe('2026-11-25');
        expect(getPragueDate(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
        expect(getPragueDate(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
    });
});

describe('pragueTimeToInstant', () => {
    it('uses UTC+1 in winter and UTC+2 in summer', () => {
        expect(pragueTimeToInstant('2026-11-24', 18).toISOString()).toBe(
            '2026-11-24T17:00:00.000Z',
        );
        expect(pragueTimeToInstant('2026-07-01', 18).toISOString()).toBe(
            '2026-07-01T16:00:00.000Z',
        );
    });

    it('handles the days of the daylight-saving transitions', () => {
        expect(pragueTimeToInstant('2026-03-29', 18).toISOString()).toBe(
            '2026-03-29T16:00:00.000Z',
        );
        expect(pragueTimeToInstant('2026-10-25', 18).toISOString()).toBe(
            '2026-10-25T17:00:00.000Z',
        );
    });

    it('handles midnight and minutes', () => {
        expect(pragueTimeToInstant('2026-03-29', 0).toISOString()).toBe('2026-03-28T23:00:00.000Z');
        expect(pragueTimeToInstant('2026-10-25', 23, 30).toISOString()).toBe(
            '2026-10-25T22:30:00.000Z',
        );
    });
});
