/**
 * Integration tests run against their own database, which global setup drops and recreates on
 * every run. `TEST_DATABASE_URL` selects it explicitly; otherwise it is the `DATABASE_URL`
 * database with a `_test` suffix on the same server.
 */
export const getTestDatabaseUrl = (): string => {
    const explicitUrl = process.env.TEST_DATABASE_URL?.trim();
    const url = new URL(explicitUrl || deriveTestDatabaseUrl());
    if (!getDatabaseName(url).endsWith('_test')) {
        throw new Error(
            `Refusing to use "${getDatabaseName(url)}" for integration tests: they drop and ` +
                'recreate the database, so its name must end with "_test".',
        );
    }
    return url.toString();
};

export const getDatabaseName = (url: URL): string => decodeURIComponent(url.pathname.slice(1));

const deriveTestDatabaseUrl = (): string => {
    const baseUrl = process.env.DATABASE_URL?.trim();
    if (!baseUrl) {
        throw new Error('DATABASE_URL or TEST_DATABASE_URL must be set for integration tests');
    }
    const url = new URL(baseUrl);
    url.pathname = `/${encodeURIComponent(`${getDatabaseName(url)}_test`)}`;
    return url.toString();
};
