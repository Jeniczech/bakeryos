import { sql } from 'drizzle-orm';
import { getDb } from './client';

export type DatabaseHealth = { ok: true } | { ok: false; error: unknown };

export const checkDatabaseHealth = async (): Promise<DatabaseHealth> => {
    try {
        await getDb().execute(sql`select 1`);
        return { ok: true };
    } catch (error) {
        return { ok: false, error };
    }
};
