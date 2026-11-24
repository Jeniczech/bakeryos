import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = PgTransaction<
    NodePgQueryResultHKT,
    typeof schema,
    ExtractTablesWithRelations<typeof schema>
>;
export type DbExecutor = Database | Transaction;

type DbConnection = { pool: Pool; db: Database };

const createConnection = (): DbConnection => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL must be set');
    }
    const pool = new Pool({ connectionString, max: 5 });
    return { pool, db: drizzle(pool, { schema }) };
};

// Created lazily so importing this module never requires DATABASE_URL (e.g. during build).
// Cached on globalThis to survive dev hot reloads and warm serverless invocations.
const globalForDb = globalThis as unknown as { bakeryDb?: DbConnection };

const getConnection = (): DbConnection => {
    globalForDb.bakeryDb ??= createConnection();
    return globalForDb.bakeryDb;
};

export const getDb = (): Database => getConnection().db;

export const closeDb = async (): Promise<void> => {
    const connection = globalForDb.bakeryDb;
    globalForDb.bakeryDb = undefined;
    await connection?.pool.end();
};
