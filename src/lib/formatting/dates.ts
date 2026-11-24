import { BUSINESS_TIME_ZONE, type CalendarDate } from '@/lib/date-time/prague';

const LOCALE = 'cs-CZ';

const longDateFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
});
const weekdayFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'short' });
const dayMonthFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
});
const pragueDateFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
});
const pragueTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

// A calendar date has no zone; formatting its UTC midnight in UTC keeps the same day.
const toUtcMidnight = (date: CalendarDate): Date => new Date(`${date}T00:00:00Z`);

/** e.g. "středa 25. listopadu". */
export const formatLongDate = (date: CalendarDate): string =>
    longDateFormatter.format(toUtcMidnight(date));

/** e.g. `{ weekday: 'st', dayMonth: '25. 11.' }`, for compact date pickers. */
export const formatShortDate = (date: CalendarDate): { weekday: string; dayMonth: string } => ({
    weekday: weekdayFormatter.format(toUtcMidnight(date)),
    dayMonth: dayMonthFormatter.format(toUtcMidnight(date)),
});

/**
 * An instant as Prague wall-clock time, e.g. "úterý 24. listopadu v 18:00". Date and time
 * are formatted separately because ICU versions disagree on the separator between them.
 */
export const formatPragueDateTime = (instant: Date): string =>
    `${pragueDateFormatter.format(instant)} v ${pragueTimeFormatter.format(instant)}`;
