import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { checkDatabaseHealth } from '@/server/db/health';

describe('checkDatabaseHealth', () => {
    afterAll(async () => {
        await closeDb();
    });

    it('reports ok when PostgreSQL is reachable', async () => {
        await expect(checkDatabaseHealth()).resolves.toEqual({ ok: true });
    });
});
