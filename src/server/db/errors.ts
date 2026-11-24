export type PgError = Error & { code: string; constraint?: string };

/** Finds the PostgreSQL error behind Drizzle's wrapper errors, if any. */
export const findPgError = (error: unknown): PgError | null => {
    let current: unknown = error;
    while (current instanceof Error) {
        if ('code' in current && typeof current.code === 'string') {
            return current as PgError;
        }
        current = current.cause;
    }
    return null;
};

export const isUniqueViolation = (error: unknown, constraint: string): boolean => {
    const pgError = findPgError(error);
    return pgError?.code === '23505' && pgError.constraint === constraint;
};

/** Deadlocks and serialization failures, which are safe to retry in a new transaction. */
export const isTransientConflict = (error: unknown): boolean => {
    const code = findPgError(error)?.code;
    return code === '40P01' || code === '40001';
};
