import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { getE2eDatabaseUrl } from './tests/support/test-database.ts';

if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const databaseUrl = getE2eDatabaseUrl();

/**
 * Runs a production build against a freshly seeded E2E database on its own port, so the run
 * never touches development data or a running dev server.
 */
export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        locale: 'cs-CZ',
        timezoneId: 'Europe/Prague',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `node tests/e2e/prepare-database.ts && npx next build && npx next start --port ${PORT}`,
        url: BASE_URL,
        // Always start fresh: a reused server would skip recreating the database.
        reuseExistingServer: false,
        timeout: 240_000,
        stdout: 'pipe',
        env: {
            DATABASE_URL: databaseUrl,
            DATABASE_URL_UNPOOLED: databaseUrl,
            APP_URL: BASE_URL,
            AUTH_SECRET: process.env.AUTH_SECRET || 'e2e-auth-secret-not-for-production',
            MANAGEMENT_TOKEN_SECRET:
                process.env.MANAGEMENT_TOKEN_SECRET || 'e2e-token-secret-not-for-production',
            ADMIN_SEED_EMAIL: 'admin@bakeryos.e2e',
            ADMIN_SEED_PASSWORD: 'e2e-admin-password',
        },
    },
});
