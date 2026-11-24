import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

const createPool = (): Pool => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL must be set');
    }
    return new Pool({ connectionString, max: 5 });
};

// Reuse the pool across hot reloads in development and across warm serverless invocations.
const globalForDb = globalThis as unknown as { bakeryPool?: Pool };

export const pool: Pool = globalForDb.bakeryPool ?? createPool();
globalForDb.bakeryPool = pool;

export const db: Database = drizzle(pool, { schema });
