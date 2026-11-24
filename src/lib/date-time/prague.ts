export const BUSINESS_TIME_ZONE = 'Europe/Prague';

/** A calendar date in `YYYY-MM-DD` form, without time or zone. */
export type CalendarDate = string;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pragueFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

type DateParts = { year: number; month: number; day: number };

const parseCalendarDate = (date: CalendarDate): DateParts | null => {
    const match = CALENDAR_DATE_PATTERN.exec(date);
    if (!match) {
        return null;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
        utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
};

const toParts = (date: CalendarDate): DateParts => {
    const parts = parseCalendarDate(date);
    if (!parts) {
        throw new RangeError(`Invalid calendar date: ${date}`);
    }
    return parts;
};

const formatUtcDate = (utc: Date): CalendarDate => utc.toISOString().slice(0, 10);

export const isValidCalendarDate = (value: string): value is CalendarDate =>
    parseCalendarDate(value) !== null;

export const addDays = (date: CalendarDate, days: number): CalendarDate => {
    const { year, month, day } = toParts(date);
    return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
};

/** 0 = Sunday … 6 = Saturday. */
export const getWeekday = (date: CalendarDate): number => {
    const { year, month, day } = toParts(date);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

const getPragueWallClock = (instant: Date) => {
    const values: Record<string, number> = {};
    for (const part of pragueFormatter.formatToParts(instant)) {
        if (part.type !== 'literal') {
            values[part.type] = Number(part.value);
        }
    }
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second,
    };
};

/** The Prague calendar date of an instant. */
export const getPragueDate = (instant: Date): CalendarDate => {
    const { year, month, day } = getPragueWallClock(instant);
    return formatUtcDate(new Date(Date.UTC(year, month - 1, day)));
};

/** Offset of Prague wall-clock time from UTC at the given instant, in milliseconds. */
const getPragueOffsetMs = (instant: Date): number => {
    const wall = getPragueWallClock(instant);
    const wallAsUtc = Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second,
    );
    const wholeSecondInstant = Math.floor(instant.getTime() / 1000) * 1000;
    return wallAsUtc - wholeSecondInstant;
};

/**
 * Converts a Prague wall-clock time on a calendar date into an instant.
 * Intended for times that exist exactly once on every day (such as 18:00); times inside a
 * daylight-saving gap or overlap are resolved to one of the candidate offsets.
 */
export const pragueTimeToInstant = (date: CalendarDate, hour: number, minute = 0): Date => {
    const { year, month, day } = toParts(date);
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const firstGuess = wallAsUtc - getPragueOffsetMs(new Date(wallAsUtc));
    const corrected = wallAsUtc - getPragueOffsetMs(new Date(firstGuess));
    return new Date(corrected);
};
