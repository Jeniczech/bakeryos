import {
    reservationConfirmationSchema,
    submissionAttemptSchema,
    type ReservationConfirmation,
    type SubmissionAttempt,
} from '@/lib/cart/checkout';

/**
 * Per-tab storage for the checkout, so a reload keeps the last attempt's idempotency key and the
 * confirmation. Values are also kept in memory, which outlives client navigations, for when
 * `sessionStorage` is unavailable. Reads parse, so stale or tampered values are ignored.
 */
const ATTEMPT_KEY = 'bakeryos:last-attempt';
const CONFIRMATION_KEY = 'bakeryos:confirmation';

const memory = new Map<string, string>();

const readRaw = (key: string): string | null => {
    try {
        return sessionStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
        return memory.get(key) ?? null;
    }
};

const write = (key: string, value: unknown): void => {
    const raw = value === null ? null : JSON.stringify(value);
    if (raw === null) {
        memory.delete(key);
    } else {
        memory.set(key, raw);
    }
    try {
        if (raw === null) {
            sessionStorage.removeItem(key);
        } else {
            sessionStorage.setItem(key, raw);
        }
    } catch {
        // Storage full or disabled: the in-memory copy still covers this page load.
    }
};

const parseRaw = <T>(
    raw: string | null,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): T | null => {
    if (raw === null) {
        return null;
    }
    try {
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

export const readStoredAttempt = (): SubmissionAttempt | null =>
    parseRaw(readRaw(ATTEMPT_KEY), submissionAttemptSchema);

export const storeAttempt = (attempt: SubmissionAttempt | null): void =>
    write(ATTEMPT_KEY, attempt);

export const storeConfirmation = (confirmation: ReservationConfirmation): void =>
    write(CONFIRMATION_KEY, confirmation);

/** A string, so `useSyncExternalStore` sees a stable snapshot until the value changes. */
export const readStoredConfirmationRaw = (): string | null => readRaw(CONFIRMATION_KEY);

export const parseStoredConfirmation = (raw: string | null): ReservationConfirmation | null =>
    parseRaw(raw, reservationConfirmationSchema);
