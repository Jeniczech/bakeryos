import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/**
 * Integration and E2E tests each run against their own database, which their setup drops and
 * recreates on every run. An explicit URL selects it; otherwise it is the `DATABASE_URL`
 * database with a suffix on the same server.
 */
const resolveDatabaseUrl = (explicitVariable: string, suffix: string): string => {
    const explicitUrl = process.env[explicitVariable]?.trim();
    return assertTestDatabaseUrl(explicitUrl || deriveDatabaseUrl(explicitVariable, suffix));
};

/** Returns the URL if its database name ends in `_test`, the guard before anything is dropped. */
export const assertTestDatabaseUrl = (databaseUrl: string): string => {
    const url = new URL(databaseUrl);
    if (!getDatabaseName(url).endsWith('_test')) {
        throw new Error(
            `Refusing to use "${getDatabaseName(url)}" for tests: they drop and recreate the ` +
                'database, so its name must end with "_test".',
        );
    }
    return url.toString();
};

const getDatabaseName = (url: URL): string => decodeURIComponent(url.pathname.slice(1));

const deriveDatabaseUrl = (explicitVariable: string, suffix: string): string => {
    const baseUrl = process.env.DATABASE_URL?.trim();
    if (!baseUrl) {
        throw new Error(`DATABASE_URL or ${explicitVariable} must be set for tests`);
    }
    const url = new URL(baseUrl);
    url.pathname = `/${encodeURIComponent(`${getDatabaseName(url)}${suffix}`)}`;
    return url.toString();
};

export const getTestDatabaseUrl = (): string => resolveDatabaseUrl('TEST_DATABASE_URL', '_test');

export const getE2eDatabaseUrl = (): string => resolveDatabaseUrl('E2E_DATABASE_URL', '_e2e_test');

/** Drops and recreates the database from the migrations, so a run starts from an empty schema. */
export const recreateDatabase = async (databaseUrl: string): Promise<void> => {
    const url = new URL(databaseUrl);
    const databaseName = getDatabaseName(url);

    const maintenanceUrl = new URL(url);
    maintenanceUrl.pathname = '/postgres';
    const maintenance = new Client({ connectionString: maintenanceUrl.toString() });
    await maintenance.connect();
    try {
        const quotedName = maintenance.escapeIdentifier(databaseName);
        await maintenance.query(`drop database if exists ${quotedName} with (force)`);
        await maintenance.query(`create database ${quotedName}`);
    } finally {
        await maintenance.end();
    }

    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
        await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    } finally {
        await client.end();
    }
};
