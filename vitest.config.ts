import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { getTestDatabaseUrl } from './tests/integration/test-database';

if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

/** Unit tests need no database; when the URL cannot be resolved, global setup reports why. */
const resolveIntegrationEnv = (): Record<string, string> => {
    try {
        const url = getTestDatabaseUrl();
        return { DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
    } catch {
        return {};
    }
};

export default defineConfig({
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
        environment: 'node',
        passWithNoTests: true,
        projects: [
            {
                extends: true,
                test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['tests/integration/**/*.test.ts'],
                    globalSetup: ['tests/integration/global-setup.ts'],
                    env: resolveIntegrationEnv(),
                },
            },
        ],
    },
});
