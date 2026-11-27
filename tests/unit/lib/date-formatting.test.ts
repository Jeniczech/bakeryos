import { describe, expect, it } from 'vitest';
import {
    formatLongDate,
    formatLongDateAccusative,
    formatPragueDateTime,
    formatPragueDateTimeWithPreposition,
    formatShortDate,
} from '@/lib/formatting/dates';

describe('formatLongDate', () => {
    it('formats the calendar date regardless of the runtime time zone', () => {
        expect(formatLongDate('2026-11-25')).toBe('středa 25. listopadu');
        expect(formatLongDate('2026-03-29')).toBe('neděle 29. března');
    });
});

describe('formatLongDateAccusative', () => {
    it('declines feminine weekdays and keeps masculine ones', () => {
        expect(formatLongDateAccusative('2026-11-25')).toBe('středu 25. listopadu');
        expect(formatLongDateAccusative('2026-11-28')).toBe('sobotu 28. listopadu');
        expect(formatLongDateAccusative('2026-11-29')).toBe('neděli 29. listopadu');
        expect(formatLongDateAccusative('2026-11-24')).toBe('úterý 24. listopadu');
        expect(formatLongDateAccusative('2026-11-27')).toBe('pátek 27. listopadu');
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

describe('formatPragueDateTimeWithPreposition', () => {
    it.each([
        ['2026-11-23T17:00:00Z', 'v pondělí 23. listopadu v 18:00'],
        ['2026-11-24T17:00:00Z', 'v úterý 24. listopadu v 18:00'],
        ['2026-11-25T17:00:00Z', 've středu 25. listopadu v 18:00'],
        ['2026-11-26T17:00:00Z', 've čtvrtek 26. listopadu v 18:00'],
        ['2026-11-27T17:00:00Z', 'v pátek 27. listopadu v 18:00'],
        ['2026-11-28T17:00:00Z', 'v sobotu 28. listopadu v 18:00'],
        ['2026-11-29T17:00:00Z', 'v neděli 29. listopadu v 18:00'],
        ['2026-07-14T16:00:00Z', 'v úterý 14. července v 18:00'],
    ])('formats %s as "%s"', (instant, expected) => {
        expect(formatPragueDateTimeWithPreposition(new Date(instant))).toBe(expected);
    });
});
