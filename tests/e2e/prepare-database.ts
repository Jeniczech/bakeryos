// Recreates and seeds the E2E database before the app server starts, so every run books against
// the same demo catalog. Run with Node's built-in TypeScript support, so imports use `.ts` paths.
import { execFileSync } from 'node:child_process';
import { recreateDatabase } from '../support/test-database.ts';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl?.endsWith('_e2e_test')) {
    throw new Error('Run through Playwright, which points DATABASE_URL at the E2E database');
}

await recreateDatabase(databaseUrl);
execFileSync(process.execPath, ['scripts/seed.ts'], { stdio: 'inherit' });
