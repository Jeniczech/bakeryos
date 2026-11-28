import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeReservationStatus } from '@/app/admin/(dashboard)/reservations/actions';
import { getPragueDate } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { dailyProductPlans, products, reservationItems, reservations } from '@/server/db/schema';
import { uniqueProductName } from '../support/unique-name';

const session = vi.hoisted(() => ({
    current: null as { user: { id: string; email: string } } | null,
}));

// Auth.js and the request-scoped Next.js APIs need a request; the session is injected instead.
vi.mock('@/server/auth/auth', () => ({ auth: async () => session.current }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const createdProductIds: string[] = [];

/** Inserted directly: the action reads the real clock, so the pickup date is today. */
const insertTodaysReservation = async () => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: uniqueProductName('Action test loaf'), price: 3000, defaultCapacity: 10 })
        .returning();
    createdProductIds.push(product.id);
    const [reservation] = await getDb()
        .insert(reservations)
        .values({
            pickupDate: getPragueDate(new Date()),
            customerName: 'Jane Doe',
            customerPhone: '+420777123456',
            source: 'admin',
            managementTokenHash: randomUUID(),
            idempotencyKey: randomUUID(),
            requestHash: 'test',
        })
        .returning();
    await getDb().insert(reservationItems).values({
        reservationId: reservation.id,
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceSnapshot: product.price,
        quantity: 1,
    });
    return reservation;
};

const submit = (reservationId: string, status: string) => {
    const formData = new FormData();
    formData.set('reservationId', reservationId);
    formData.set('status', status);
    return changeReservationStatus({ error: null }, formData);
};

const readReservation = async (reservationId: string) => {
    const [row] = await getDb()
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId));
    return row;
};

beforeEach(() => {
    session.current = null;
});

afterEach(async () => {
    const productIds = createdProductIds.splice(0);
    if (productIds.length === 0) {
        return;
    }
    const reservationIds = (
        await getDb()
            .selectDistinct({ id: reservationItems.reservationId })
            .from(reservationItems)
            .where(inArray(reservationItems.productId, productIds))
    ).map((row) => row.id);
    if (reservationIds.length > 0) {
        await getDb()
            .delete(reservationItems)
            .where(inArray(reservationItems.reservationId, reservationIds));
        await getDb().delete(reservations).where(inArray(reservations.id, reservationIds));
    }
    await getDb().delete(dailyProductPlans).where(inArray(dailyProductPlans.productId, productIds));
    await getDb().delete(products).where(inArray(products.id, productIds));
});

afterAll(async () => {
    await closeDb();
});

describe('changeReservationStatus', () => {
    it.each(['picked_up', 'no_show', 'cancelled'])(
        'redirects an unauthenticated %s request to the login page without writing',
        async (status) => {
            const reservation = await insertTodaysReservation();

            await expect(submit(reservation.id, status)).rejects.toMatchObject({
                digest: expect.stringContaining('/admin/login'),
            });
            expect(await readReservation(reservation.id)).toMatchObject({
                status: 'confirmed',
                cancelledAt: null,
            });
        },
    );

    describe('for a signed-in admin', () => {
        beforeEach(() => {
            session.current = { user: { id: randomUUID(), email: 'admin@example.com' } };
        });

        it('marks a reservation for today picked up', async () => {
            const reservation = await insertTodaysReservation();

            await expect(submit(reservation.id, 'picked_up')).resolves.toEqual({ error: null });
            expect((await readReservation(reservation.id)).status).toBe('picked_up');
        });

        it('cancels through the shared service, keeping a same-day cancellation in production', async () => {
            const reservation = await insertTodaysReservation();

            await expect(submit(reservation.id, 'cancelled')).resolves.toEqual({ error: null });
            expect(await readReservation(reservation.id)).toMatchObject({
                status: 'cancelled',
                retainForProduction: true,
            });
        });

        it('reports a rejected transition', async () => {
            const reservation = await insertTodaysReservation();
            await submit(reservation.id, 'no_show');

            await expect(submit(reservation.id, 'picked_up')).resolves.toEqual({
                error: 'INVALID_TRANSITION',
            });
            expect((await readReservation(reservation.id)).status).toBe('no_show');
        });

        it.each(['confirmed', 'deleted', ''])('rejects the status %j', async (status) => {
            const reservation = await insertTodaysReservation();

            await expect(submit(reservation.id, status)).resolves.toEqual({
                error: 'INVALID_REQUEST',
            });
            expect((await readReservation(reservation.id)).status).toBe('confirmed');
        });
    });
});
