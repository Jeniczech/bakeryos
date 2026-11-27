import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import * as schema from '@/server/db/schema';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import { getCommittedQuantity } from '@/server/domain/availability';
import {
    InvalidRequestError,
    ReservationNotFoundError,
    StatusTransitionError,
} from '@/server/domain/errors';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';
import { createReservation } from '@/server/services/reservations/create-reservation';
import { getDailyReservations } from '@/server/services/reservations/get-daily-reservations';
import { updateReservationStatus } from '@/server/services/reservations/update-reservation-status';

// Far outside any real booking window; the clock is injected relative to this date.
const PICKUP_DATE = '2099-10-14'; // Wednesday
const WEDNESDAY = 3;
const BEFORE_CUTOFF = pragueTimeToInstant('2099-10-13', 12);
const PICKUP_DAY = pragueTimeToInstant('2099-10-14', 9);
const DAY_AFTER_PICKUP = pragueTimeToInstant('2099-10-15', 9);

/** A separate pool for the lock holder and lock-wait polling. */
const observerPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const observerDb = drizzle(observerPool, { schema });

const createdProductIds: string[] = [];

const insertProduct = async (name = 'Status test loaf') => {
    const [product] = await getDb()
        .insert(products)
        .values({ name, price: 4000, defaultCapacity: 10 })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const reserve = (
    items: Array<{ productId: string; quantity: number }>,
    customer = { name: 'Jane Doe', phone: '+420777123456' },
) =>
    createReservation(
        {
            idempotencyKey: randomUUID(),
            pickupDate: PICKUP_DATE,
            customer,
            items,
            source: 'online',
        },
        { now: BEFORE_CUTOFF },
    );

const readReservation = async (reservationId: string) => {
    const [row] = await getDb()
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId));
    return row;
};

const readCommitted = async (productId: string) => {
    const committed = await getCommittedQuantities(getDb(), PICKUP_DATE, [productId]);
    const quantities = committed.get(productId);
    return quantities ? getCommittedQuantity(quantities) : 0;
};

const waitUntilBlocked = async (holderPid: number, expected: number): Promise<void> => {
    const deadline = Date.now() + 5_000;
    for (;;) {
        // Later waiters queue behind earlier ones, so count indirect blocking too.
        const result = await observerPool.query<{ count: number }>(
            `with recursive blocked(pid) as (
                select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))
                union
                select activity.pid
                from pg_stat_activity activity
                join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
            )
            select count(*)::int as count from blocked`,
            [holderPid],
        );
        if (result.rows[0].count >= expected) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${expected} transaction(s) to block`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

/**
 * Locks the reservation row on the observer pool until `release()`, so competing changes
 * queue behind it in a known order. Row-lock waiters are granted the lock in arrival order.
 */
const holdReservationLock = async (reservationId: string) => {
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked: (pid: number) => void = () => {};
    const locked = new Promise<number>((resolve) => (signalLocked = resolve));

    const holder = observerDb.transaction(async (tx) => {
        await tx
            .select({ id: reservations.id })
            .from(reservations)
            .where(eq(reservations.id, reservationId))
            .for('update');
        const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        signalLocked(result.rows[0].pid);
        await released;
    });
    const pid = await Promise.race([locked, holder.then(() => -1)]);
    return {
        queue: async <T>(run: () => Promise<T>, position: number) => {
            const result = run();
            result.catch(() => {});
            await Promise.race([waitUntilBlocked(pid, position), result]);
            return { result };
        },
        release: async () => {
            release();
            await holder;
        },
    };
};

beforeAll(async () => {
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: WEDNESDAY, isOpen: true })
        .onConflictDoNothing();
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
    await observerPool.end();
    await closeDb();
});

describe('getDailyReservations', () => {
    it('lists the date’s reservations with items, phone and allowed status changes', async () => {
        const rye = await insertProduct('Žitný chléb');
        const bun = await insertProduct('Bulka');
        const first = await reserve([
            { productId: rye.id, quantity: 1 },
            { productId: bun.id, quantity: 3 },
        ]);
        const second = await reserve([{ productId: rye.id, quantity: 2 }], {
            name: 'John Roe',
            phone: '+420608000111',
        });
        await cancelReservation(
            { actor: 'admin', reservationId: second.reservationId },
            {
                now: PICKUP_DAY,
            },
        );

        const list = await getDailyReservations(PICKUP_DATE, { now: PICKUP_DAY });
        const ours = list.filter((row) =>
            [first.reservationId, second.reservationId].includes(row.reservationId),
        );

        expect(ours).toEqual([
            {
                reservationId: first.reservationId,
                reservationNumber: first.reservationNumber,
                customerName: 'Jane Doe',
                customerPhone: '+420777123456',
                source: 'online',
                status: 'confirmed',
                retainForProduction: false,
                createdAt: expect.any(Date),
                totalPrice: 16000,
                items: [
                    { productId: bun.id, productName: 'Bulka', unitPrice: 4000, quantity: 3 },
                    { productId: rye.id, productName: 'Žitný chléb', unitPrice: 4000, quantity: 1 },
                ],
                allowedStatusTargets: ['picked_up', 'no_show', 'cancelled'],
            },
            expect.objectContaining({
                reservationId: second.reservationId,
                customerName: 'John Roe',
                status: 'cancelled',
                retainForProduction: true,
                allowedStatusTargets: [],
            }),
        ]);
        expect(first.reservationNumber < second.reservationNumber).toBe(true);
    });

    it('offers only cancellation before the pickup date and only outcomes after it', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);
        const find = async (now: Date) =>
            (await getDailyReservations(PICKUP_DATE, { now })).find(
                (row) => row.reservationId === created.reservationId,
            );

        expect((await find(BEFORE_CUTOFF))?.allowedStatusTargets).toEqual(['cancelled']);
        expect((await find(DAY_AFTER_PICKUP))?.allowedStatusTargets).toEqual([
            'picked_up',
            'no_show',
        ]);
    });

    it('rejects an invalid date', async () => {
        await expect(getDailyReservations('2099-02-30')).rejects.toBeInstanceOf(
            InvalidRequestError,
        );
    });
});

describe('updateReservationStatus', () => {
    it.each(['picked_up', 'no_show'] as const)(
        'records %s on the pickup date and keeps the items committed',
        async (status) => {
            const product = await insertProduct();
            const created = await reserve([{ productId: product.id, quantity: 2 }]);

            await updateReservationStatus(
                { reservationId: created.reservationId, status },
                { now: PICKUP_DAY },
            );

            expect(await readReservation(created.reservationId)).toMatchObject({
                status,
                cancelledAt: null,
                retainForProduction: false,
            });
            expect(await readCommitted(product.id)).toBe(2);
        },
    );

    it('rejects a pickup outcome before the pickup date without writing', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);

        await expect(
            updateReservationStatus(
                { reservationId: created.reservationId, status: 'picked_up' },
                { now: BEFORE_CUTOFF },
            ),
        ).rejects.toMatchObject({ code: 'BEFORE_PICKUP_DATE' });
        expect((await readReservation(created.reservationId)).status).toBe('confirmed');
    });

    it('records a no-show after the pickup date but rejects a cancellation', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);

        await expect(
            cancelReservation(
                { actor: 'admin', reservationId: created.reservationId },
                { now: DAY_AFTER_PICKUP },
            ),
        ).rejects.toMatchObject({ code: 'PICKUP_DATE_PASSED' });
        expect((await readReservation(created.reservationId)).status).toBe('confirmed');

        await updateReservationStatus(
            { reservationId: created.reservationId, status: 'no_show' },
            { now: DAY_AFTER_PICKUP },
        );
        expect((await readReservation(created.reservationId)).status).toBe('no_show');
    });

    it('rejects changing a terminal status', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);
        await cancelReservation(
            { actor: 'admin', reservationId: created.reservationId },
            { now: PICKUP_DAY },
        );

        await expect(
            updateReservationStatus(
                { reservationId: created.reservationId, status: 'picked_up' },
                { now: PICKUP_DAY },
            ),
        ).rejects.toEqual(new StatusTransitionError('INVALID_TRANSITION'));
        expect((await readReservation(created.reservationId)).status).toBe('cancelled');
    });

    it('treats setting the current status again as a no-op', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);
        const input = { reservationId: created.reservationId, status: 'picked_up' } as const;

        await updateReservationStatus(input, { now: PICKUP_DAY });
        await updateReservationStatus(input, { now: PICKUP_DAY });

        expect((await readReservation(created.reservationId)).status).toBe('picked_up');
    });

    it.each(['not-a-uuid', randomUUID()])('reports reservation %s as not found', async (id) => {
        await expect(
            updateReservationStatus(
                { reservationId: id, status: 'picked_up' },
                { now: PICKUP_DAY },
            ),
        ).rejects.toBeInstanceOf(ReservationNotFoundError);
    });
});

describe('competing status changes', () => {
    it('lets the first of picked_up and no_show win and rejects the other', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);
        const reservationId = created.reservationId;
        const holder = await holdReservationLock(reservationId);

        const pickedUp = await holder.queue(
            () =>
                updateReservationStatus(
                    { reservationId, status: 'picked_up' },
                    { now: PICKUP_DAY },
                ),
            1,
        );
        const noShow = await holder.queue(
            () =>
                updateReservationStatus({ reservationId, status: 'no_show' }, { now: PICKUP_DAY }),
            2,
        );
        await holder.release();

        await expect(pickedUp.result).resolves.toBeUndefined();
        await expect(noShow.result).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(await readReservation(reservationId)).toMatchObject({
            status: 'picked_up',
            cancelledAt: null,
        });
    });

    it('accepts the same outcome submitted twice at once, writing it once', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 1 }]);
        const reservationId = created.reservationId;
        const holder = await holdReservationLock(reservationId);

        const submit = () =>
            updateReservationStatus({ reservationId, status: 'picked_up' }, { now: PICKUP_DAY });
        const first = await holder.queue(submit, 1);
        const second = await holder.queue(submit, 2);
        await holder.release();

        await expect(first.result).resolves.toBeUndefined();
        await expect(second.result).resolves.toBeUndefined();
        expect(await readReservation(reservationId)).toMatchObject({ status: 'picked_up' });
    });

    it('rejects picked_up when a late admin cancellation commits first', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 2 }]);
        const reservationId = created.reservationId;
        const holder = await holdReservationLock(reservationId);

        const cancel = await holder.queue(
            () => cancelReservation({ actor: 'admin', reservationId }, { now: PICKUP_DAY }),
            1,
        );
        const pickedUp = await holder.queue(
            () =>
                updateReservationStatus(
                    { reservationId, status: 'picked_up' },
                    { now: PICKUP_DAY },
                ),
            2,
        );
        await holder.release();

        await expect(cancel.result).resolves.toMatchObject({ status: 'cancelled' });
        await expect(pickedUp.result).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(await readReservation(reservationId)).toMatchObject({
            status: 'cancelled',
            retainForProduction: true,
        });
        expect(await readCommitted(product.id)).toBe(2);
    });

    it('rejects the admin cancellation when no_show commits first', async () => {
        const product = await insertProduct();
        const created = await reserve([{ productId: product.id, quantity: 2 }]);
        const reservationId = created.reservationId;
        const holder = await holdReservationLock(reservationId);

        const noShow = await holder.queue(
            () =>
                updateReservationStatus({ reservationId, status: 'no_show' }, { now: PICKUP_DAY }),
            1,
        );
        const cancel = await holder.queue(
            () => cancelReservation({ actor: 'admin', reservationId }, { now: PICKUP_DAY }),
            2,
        );
        await holder.release();

        await expect(noShow.result).resolves.toBeUndefined();
        await expect(cancel.result).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(await readReservation(reservationId)).toMatchObject({
            status: 'no_show',
            cancelledAt: null,
            retainForProduction: false,
        });
        expect(await readCommitted(product.id)).toBe(2);
    });
});
