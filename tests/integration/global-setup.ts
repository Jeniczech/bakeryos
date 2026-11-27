import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { getDatabaseName, getTestDatabaseUrl } from './test-database';

/** Recreates the test database from the migrations, so every run starts from an empty schema. */
const setup = async (): Promise<void> => {
    const testUrl = new URL(getTestDatabaseUrl());
    const databaseName = getDatabaseName(testUrl);

    const maintenanceUrl = new URL(testUrl);
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

    const client = new Client({ connectionString: testUrl.toString() });
    await client.connect();
    try {
        await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    } finally {
        await client.end();
    }
};

export default setup;
