import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { lockDailyPlans, materializeDailyPlans } from '@/server/db/lock-daily-plans';
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
    InsufficientCapacityError,
    PickupDateUnavailableError,
    PlanBelowCommitmentsError,
    StatusTransitionError,
} from '@/server/domain/errors';
import { updateDailyPlan } from '@/server/services/production/update-daily-plan';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';
import {
    createReservation,
    type CreateReservationInput,
    type CreateReservationResult,
} from '@/server/services/reservations/create-reservation';

// Far outside any real booking window; the clock is injected relative to this date.
const PICKUP_DATE = '2099-07-15'; // Wednesday
const WEDNESDAY = 3;
const BEFORE_CUTOFF = pragueTimeToInstant('2099-07-14', 12);
const CUTOFF = pragueTimeToInstant('2099-07-14', 18);
const JUST_BEFORE_CUTOFF = new Date(CUTOFF.getTime() - 100);

/**
 * A separate pool for the lock holder and lock-wait polling, so the services under test can
 * use every connection of the application pool while the holder blocks them.
 */
const observerPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const observerDb = drizzle(observerPool, { schema });

const createdProductIds: string[] = [];

const insertProduct = async (defaultCapacity: number) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Concurrency test loaf', price: 4500, defaultCapacity })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const buildInput = (items: CreateReservationInput['items']): CreateReservationInput => ({
    idempotencyKey: randomUUID(),
    pickupDate: PICKUP_DATE,
    customer: { name: 'Jane Doe', phone: '+420777123456' },
    items,
    source: 'admin',
});

const reserve = (items: CreateReservationInput['items']) =>
    createReservation(buildInput(items), { now: BEFORE_CUTOFF });

/** Counts backends waiting, directly or through other waiters, on the holder's locks. */
const countBlockedBy = async (holderPid: number): Promise<number> => {
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
    return result.rows[0].count;
};

const waitUntilBlocked = async (holderPid: number, expected: number): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while ((await countBlockedBy(holderPid)) < expected) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${expected} transaction(s) to block`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};

/**
 * Locks the plans in a transaction on the observer pool and keeps them locked until
 * `release()`, so competing writers can be queued behind it in a known order.
 *
 * With `planExists: false` the holder creates the plans itself and keeps them uncommitted,
 * so competitors block on the first-write insert instead. They then wake together in any
 * order, so only the outcome counts are deterministic, not which competitor wins.
 */
const holdPlanLocks = async (productIds: string[], { planExists = true } = {}) => {
    if (planExists) {
        // Committed first: waiters on an uncommitted insert would wake together in any order,
        // while `FOR UPDATE` waiters queue for the row lock in arrival order.
        await getDb().transaction((tx) => materializeDailyPlans(tx, PICKUP_DATE, productIds));
    }
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked: (pid: number) => void = () => {};
    const locked = new Promise<number>((resolve) => (signalLocked = resolve));

    const holder = observerDb.transaction(async (tx) => {
        await lockDailyPlans(tx, PICKUP_DATE, productIds);
        const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        signalLocked(result.rows[0].pid);
        await released;
    });
    // Racing the holder surfaces its error instead of hanging if it fails before locking.
    const pid = await Promise.race([locked, holder.then(() => -1)]);
    return {
        pid,
        /** Starts `run` and resolves once it, and everything started earlier, waits on the holder. */
        queue: async <T>(
            run: () => Promise<T>,
            position: number,
        ): Promise<{ result: Promise<T> }> => {
            const result = run();
            // Keep an early rejection from going unhandled while we wait; callers await it later.
            result.catch(() => {});
            await Promise.race([waitUntilBlocked(pid, position), result]);
            // Wrapped so the caller gets the pending promise instead of awaiting its outcome.
            return { result };
        },
        release: async () => {
            release();
            await holder;
        },
    };
};

const readCommitted = async (productIds: string[]) => {
    const committed = await getCommittedQuantities(getDb(), PICKUP_DATE, productIds);
    return new Map(
        [...committed].map(([id, quantities]) => [id, getCommittedQuantity(quantities)]),
    );
};

const readPlan = async (productId: string) => {
    const [plan] = await getDb()
        .select()
        .from(dailyProductPlans)
        .where(
            and(
                eq(dailyProductPlans.productId, productId),
                eq(dailyProductPlans.date, PICKUP_DATE),
            ),
        );
    return plan;
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
    const items = await getDb()
        .select({ reservationId: reservationItems.reservationId })
        .from(reservationItems)
        .where(inArray(reservationItems.productId, productIds));
    const reservationIds = [...new Set(items.map((item) => item.reservationId))];
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

describe('concurrent reservations', () => {
    it('lets exactly one of two competing requests claim the final unit', async () => {
        const bread = await insertProduct(5);
        await reserve([{ productId: bread.id, quantity: 4 }]);

        const holder = await holdPlanLocks([bread.id]);
        let first: Promise<CreateReservationResult> | undefined;
        let second: Promise<CreateReservationResult> | undefined;
        try {
            first = (await holder.queue(() => reserve([{ productId: bread.id, quantity: 1 }]), 1))
                .result;
            second = (await holder.queue(() => reserve([{ productId: bread.id, quantity: 1 }]), 2))
                .result;
        } finally {
            await holder.release();
        }

        const outcomes = await Promise.allSettled([first, second]);
        expect(outcomes[0].status).toBe('fulfilled');
        expect(outcomes[1]).toMatchObject({
            status: 'rejected',
            reason: expect.any(InsufficientCapacityError),
        });
        if (outcomes[0].status !== 'fulfilled' || outcomes[1].status !== 'rejected') {
            return;
        }
        expect((outcomes[1].reason as InsufficientCapacityError).shortages).toEqual([
            { productId: bread.id, requested: 1, available: 0 },
        ]);

        expect((await readCommitted([bread.id])).get(bread.id)).toBe(5);
        expect((await readPlan(bread.id)).capacity).toBe(5);
        const stored = await getDb()
            .select({ reservationId: reservationItems.reservationId })
            .from(reservationItems)
            .where(eq(reservationItems.productId, bread.id));
        expect(stored).toHaveLength(2);
        expect(stored.map((row) => row.reservationId)).toContain(outcomes[0].value.reservationId);
    });

    it('lets exactly one of two requests claim the final unit while the plan is first created', async () => {
        const bread = await insertProduct(1);

        const holder = await holdPlanLocks([bread.id], { planExists: false });
        const pending: Promise<CreateReservationResult>[] = [];
        try {
            for (const position of [1, 2]) {
                const reservation = () => reserve([{ productId: bread.id, quantity: 1 }]);
                pending.push((await holder.queue(reservation, position)).result);
            }
        } finally {
            await holder.release();
        }

        const outcomes = await Promise.allSettled(pending);
        const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        const rejected = outcomes.flatMap((outcome) =>
            outcome.status === 'rejected' ? [outcome.reason] : [],
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toBeInstanceOf(InsufficientCapacityError);

        const plans = await getDb()
            .select()
            .from(dailyProductPlans)
            .where(eq(dailyProductPlans.productId, bread.id));
        expect(plans).toMatchObject([{ date: PICKUP_DATE, capacity: 1 }]);
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(1);
        const stored = await getDb()
            .select({ reservationId: reservationItems.reservationId })
            .from(reservationItems)
            .where(eq(reservationItems.productId, bread.id));
        expect(stored).toHaveLength(1);
    });

    it('keeps overlapping multi-product carts consistent and all-or-nothing', async () => {
        const capacity = 5;
        const created = await Promise.all([1, 2, 3].map(() => insertProduct(capacity)));
        const [a, b, c] = created.map((product) => product.id);
        const carts = [
            [
                { productId: a, quantity: 3 },
                { productId: b, quantity: 3 },
            ],
            [
                { productId: c, quantity: 3 },
                { productId: b, quantity: 2 },
            ],
            [
                { productId: c, quantity: 3 },
                { productId: a, quantity: 2 },
            ],
            [
                { productId: b, quantity: 1 },
                { productId: a, quantity: 1 },
                { productId: c, quantity: 1 },
            ],
            [
                { productId: a, quantity: 2 },
                { productId: c, quantity: 2 },
            ],
        ];

        const holder = await holdPlanLocks([a, b, c]);
        const pending: Promise<CreateReservationResult>[] = [];
        try {
            for (const [index, cart] of carts.entries()) {
                pending.push((await holder.queue(() => reserve(cart), index + 1)).result);
            }
        } finally {
            await holder.release();
        }
        const outcomes = await Promise.allSettled(pending);

        const fulfilled = outcomes.flatMap((outcome) =>
            outcome.status === 'fulfilled' ? [outcome.value] : [],
        );
        const rejected = outcomes.flatMap((outcome) =>
            outcome.status === 'rejected' ? [outcome.reason] : [],
        );
        expect(fulfilled.length).toBeGreaterThan(0);
        expect(rejected.length).toBeGreaterThan(0);
        for (const reason of rejected) {
            expect(reason).toBeInstanceOf(InsufficientCapacityError);
        }

        // Only successful carts are stored, each with every item.
        const expected = new Map([a, b, c].map((id) => [id, 0]));
        for (const result of fulfilled) {
            for (const item of result.items) {
                expected.set(item.productId, (expected.get(item.productId) ?? 0) + item.quantity);
            }
        }
        const committed = await readCommitted([a, b, c]);
        expect(committed).toEqual(expected);
        for (const quantity of committed.values()) {
            expect(quantity).toBeLessThanOrEqual(capacity);
        }
        const stored = await getDb()
            .select({ reservationId: reservationItems.reservationId })
            .from(reservationItems)
            .where(inArray(reservationItems.productId, [a, b, c]));
        expect(stored).toHaveLength(
            fulfilled.reduce((sum, result) => sum + result.items.length, 0),
        );
        expect(new Set(stored.map((row) => row.reservationId))).toEqual(
            new Set(fulfilled.map((result) => result.reservationId)),
        );
    });
});

describe('reservation concurrent with capacity reduction', () => {
    const reduceTo = (productId: string, capacity: number) =>
        updateDailyPlan(
            { productId, date: PICKUP_DATE, capacity, walkInQuantity: 0 },
            { now: BEFORE_CUTOFF },
        );

    it('rejects the reduction when the reservation commits first', async () => {
        const bread = await insertProduct(10);

        const holder = await holdPlanLocks([bread.id]);
        let reservation: Promise<CreateReservationResult> | undefined;
        let reduction: Promise<unknown> | undefined;
        try {
            reservation = (
                await holder.queue(() => reserve([{ productId: bread.id, quantity: 6 }]), 1)
            ).result;
            reduction = (await holder.queue(() => reduceTo(bread.id, 5), 2)).result;
        } finally {
            await holder.release();
        }

        await expect(reservation).resolves.toMatchObject({ status: 'confirmed' });
        await expect(reduction).rejects.toBeInstanceOf(PlanBelowCommitmentsError);
        expect(await readPlan(bread.id)).toMatchObject({ capacity: 10 });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(6);
    });

    it('rejects the reservation when the reduction commits first', async () => {
        const bread = await insertProduct(10);

        const holder = await holdPlanLocks([bread.id]);
        let reduction: Promise<unknown> | undefined;
        let reservation: Promise<CreateReservationResult> | undefined;
        try {
            reduction = (await holder.queue(() => reduceTo(bread.id, 5), 1)).result;
            reservation = (
                await holder.queue(() => reserve([{ productId: bread.id, quantity: 6 }]), 2)
            ).result;
        } finally {
            await holder.release();
        }

        await expect(reduction).resolves.toMatchObject({ capacity: 5 });
        await expect(reservation).rejects.toMatchObject({
            shortages: [{ productId: bread.id, requested: 6, available: 5 }],
        });
        expect(await readPlan(bread.id)).toMatchObject({ capacity: 5 });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(0);
    });
});

describe('cancellation concurrent with a new reservation', () => {
    const cancel = (reservationId: string) =>
        cancelReservation({ actor: 'admin', reservationId }, { now: BEFORE_CUTOFF });

    it('lets the reservation use capacity released by a cancellation that commits first', async () => {
        const bread = await insertProduct(3);
        const existing = await reserve([{ productId: bread.id, quantity: 3 }]);

        const holder = await holdPlanLocks([bread.id]);
        let cancellation: Promise<unknown> | undefined;
        let reservation: Promise<CreateReservationResult> | undefined;
        try {
            cancellation = (await holder.queue(() => cancel(existing.reservationId), 1)).result;
            reservation = (
                await holder.queue(() => reserve([{ productId: bread.id, quantity: 3 }]), 2)
            ).result;
        } finally {
            await holder.release();
        }

        await expect(cancellation).resolves.toMatchObject({ status: 'cancelled' });
        await expect(reservation).resolves.toMatchObject({ status: 'confirmed' });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(3);
    });

    it('rejects the reservation when it locks before the cancellation releases capacity', async () => {
        const bread = await insertProduct(3);
        const existing = await reserve([{ productId: bread.id, quantity: 3 }]);

        const holder = await holdPlanLocks([bread.id]);
        let reservation: Promise<CreateReservationResult> | undefined;
        let cancellation: Promise<unknown> | undefined;
        try {
            reservation = (
                await holder.queue(() => reserve([{ productId: bread.id, quantity: 3 }]), 1)
            ).result;
            cancellation = (await holder.queue(() => cancel(existing.reservationId), 2)).result;
        } finally {
            await holder.release();
        }

        await expect(reservation).rejects.toBeInstanceOf(InsufficientCapacityError);
        await expect(cancellation).resolves.toMatchObject({ status: 'cancelled' });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(0);
    });
});

describe('lock waits that cross the cutoff', () => {
    // Only `Date` is faked, so the services read the moved clock while timers and the
    // database driver keep running in real time.
    const startClockJustBeforeCutoff = () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(JUST_BEFORE_CUTOFF);
    };

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects a customer cancellation that obtains its locks at the cutoff', async () => {
        const bread = await insertProduct(5);
        const created = await createReservation(
            { ...buildInput([{ productId: bread.id, quantity: 2 }]), source: 'online' },
            { now: BEFORE_CUTOFF },
        );
        startClockJustBeforeCutoff();

        const holder = await holdPlanLocks([bread.id]);
        let cancellation: Promise<unknown> | undefined;
        try {
            cancellation = (
                await holder.queue(
                    () => cancelReservation({ actor: 'customer', token: created.managementToken }),
                    1,
                )
            ).result;
            vi.setSystemTime(CUTOFF);
        } finally {
            await holder.release();
        }

        await expect(cancellation).rejects.toBeInstanceOf(StatusTransitionError);
        await expect(cancellation).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(2);
    });

    it('retains the items when an admin cancellation obtains its locks at the cutoff', async () => {
        const bread = await insertProduct(5);
        const created = await reserve([{ productId: bread.id, quantity: 2 }]);
        startClockJustBeforeCutoff();

        const holder = await holdPlanLocks([bread.id]);
        let cancellation: Promise<unknown> | undefined;
        try {
            cancellation = (
                await holder.queue(
                    () =>
                        cancelReservation({ actor: 'admin', reservationId: created.reservationId }),
                    1,
                )
            ).result;
            vi.setSystemTime(CUTOFF);
        } finally {
            await holder.release();
        }

        await expect(cancellation).resolves.toMatchObject({ status: 'cancelled' });
        const [row] = await getDb()
            .select()
            .from(reservations)
            .where(eq(reservations.id, created.reservationId));
        expect(row).toMatchObject({ retainForProduction: true, cancelledAt: CUTOFF });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(2);
    });

    it('rejects an online reservation that obtains its locks at the cutoff', async () => {
        const bread = await insertProduct(5);
        startClockJustBeforeCutoff();

        const holder = await holdPlanLocks([bread.id]);
        let creation: Promise<unknown> | undefined;
        try {
            creation = (
                await holder.queue(
                    () =>
                        createReservation({
                            ...buildInput([{ productId: bread.id, quantity: 1 }]),
                            source: 'online',
                        }),
                    1,
                )
            ).result;
            vi.setSystemTime(CUTOFF);
        } finally {
            await holder.release();
        }

        await expect(creation).rejects.toBeInstanceOf(PickupDateUnavailableError);
        await expect(creation).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
        expect((await readCommitted([bread.id])).get(bread.id)).toBe(0);
    });
});
