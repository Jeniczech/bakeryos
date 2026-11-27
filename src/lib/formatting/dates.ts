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

// Feminine weekdays change after "na" or "v"; the masculine ones keep their nominative form.
const ACCUSATIVE_WEEKDAYS: Readonly<Record<string, string>> = {
    středa: 'středu',
    sobota: 'sobotu',
    neděle: 'neděli',
};

const joinAccusative = (parts: Intl.DateTimeFormatPart[]): string =>
    parts
        .map((part) =>
            part.type === 'weekday' ? (ACCUSATIVE_WEEKDAYS[part.value] ?? part.value) : part.value,
        )
        .join('');

/** The long date after the preposition "na", e.g. "středu 25. listopadu". */
export const formatLongDateAccusative = (date: CalendarDate): string =>
    joinAccusative(longDateFormatter.formatToParts(toUtcMidnight(date)));

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

/**
 * An instant as Prague wall-clock time with its preposition, e.g. "v sobotu 28. listopadu
 * v 18:00" or "ve středu 25. listopadu v 18:00".
 */
export const formatPragueDateTimeWithPreposition = (instant: Date): string => {
    const date = joinAccusative(pragueDateFormatter.formatToParts(instant));
    const preposition = /^(středu|čtvrtek)/.test(date) ? 've' : 'v';
    return `${preposition} ${date} v ${pragueTimeFormatter.format(instant)}`;
};
