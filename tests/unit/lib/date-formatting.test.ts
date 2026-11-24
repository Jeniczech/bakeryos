import { describe, expect, it } from 'vitest';
import { formatLongDate, formatPragueDateTime, formatShortDate } from '@/lib/formatting/dates';

describe('formatLongDate', () => {
    it('formats the calendar date regardless of the runtime time zone', () => {
        expect(formatLongDate('2026-11-25')).toBe('středa 25. listopadu');
        expect(formatLongDate('2026-03-29')).toBe('neděle 29. března');
    });
});

describe('formatShortDate', () => {
    it('splits weekday and day-month', () => {
        expect(formatShortDate('2026-11-25')).toEqual({ weekday: 'st', dayMonth: '25. 11.' });
    });
});

describe('formatPragueDateTime', () => {
    it('shows Prague wall-clock time in winter and summer', () => {
        expect(formatPragueDateTime(new Date('2026-11-24T17:00:00Z'))).toBe(
            'úterý 24. listopadu v 18:00',
        );
        expect(formatPragueDateTime(new Date('2026-07-14T16:00:00Z'))).toBe(
            'úterý 14. července v 18:00',
        );
    });
});
