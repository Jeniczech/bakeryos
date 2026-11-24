import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
    throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL must be set');
}

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/server/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url },
    strict: true,
    verbose: true,
});
