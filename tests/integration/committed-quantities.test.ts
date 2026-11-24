import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, type DbExecutor } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { lockDailyPlans } from '@/server/db/lock-daily-plans';
import { dailyProductPlans, products, reservationItems, reservations } from '@/server/db/schema';
import type { ReservationStatus } from '@/server/domain/reservation-rules';

// Far outside any booking window, so tests never collide with seeded or demo data.
const DATE = '2099-04-14';
const OTHER_DATE = '2099-04-15';

const createdProductIds: string[] = [];
const createdReservationIds: string[] = [];

const insertProduct = async () => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Aggregation test loaf', price: 5000, defaultCapacity: 50 })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const insertReservation = async (
    db: DbExecutor,
    options: {
        date?: string;
        status?: ReservationStatus;
        retainForProduction?: boolean;
        items: Array<{ productId: string; quantity: number }>;
    },
) => {
    const status = options.status ?? 'confirmed';
    const [reservation] = await db
        .insert(reservations)
        .values({
            pickupDate: options.date ?? DATE,
            customerName: 'Jane Doe',
            customerPhone: '+420777123456',
            source: 'online',
            status,
            retainForProduction: options.retainForProduction ?? false,
            cancelledAt: status === 'cancelled' ? new Date() : null,
            managementTokenHash: randomUUID(),
            idempotencyKey: randomUUID(),
            requestHash: 'hash',
        })
        .returning();
    createdReservationIds.push(reservation.id);
    await db.insert(reservationItems).values(
        options.items.map((item) => ({
            reservationId: reservation.id,
            productId: item.productId,
            productNameSnapshot: 'Aggregation test loaf',
            unitPriceSnapshot: 5000,
            quantity: item.quantity,
        })),
    );
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('getCommittedQuantities', () => {
    afterEach(async () => {
        const reservationIds = createdReservationIds.splice(0);
        const productIds = createdProductIds.splice(0);
        if (reservationIds.length > 0) {
            await getDb()
                .delete(reservationItems)
                .where(inArray(reservationItems.reservationId, reservationIds));
            await getDb().delete(reservations).where(inArray(reservations.id, reservationIds));
        }
        if (productIds.length > 0) {
            await getDb()
                .delete(dailyProductPlans)
                .where(inArray(dailyProductPlans.productId, productIds));
            await getDb().delete(products).where(inArray(products.id, productIds));
        }
    });

    afterAll(async () => {
        await closeDb();
    });

    it('counts active and retained items and ignores early cancellations', async () => {
        const bread = await insertProduct();
        const db = getDb();
        await insertReservation(db, { items: [{ productId: bread.id, quantity: 2 }] });
        await insertReservation(db, {
            status: 'picked_up',
            items: [{ productId: bread.id, quantity: 3 }],
        });
        await insertReservation(db, {
            status: 'no_show',
            items: [{ productId: bread.id, quantity: 1 }],
        });
        await insertReservation(db, {
            status: 'cancelled',
            retainForProduction: true,
            items: [{ productId: bread.id, quantity: 4 }],
        });
        await insertReservation(db, {
            status: 'cancelled',
            retainForProduction: false,
            items: [{ productId: bread.id, quantity: 5 }],
        });

        const committed = await getCommittedQuantities(db, DATE, [bread.id]);

        expect(committed.get(bread.id)).toEqual({ activeReserved: 6, retainedCancelled: 4 });
    });

    it('separates products in multi-product reservations and ignores other dates', async () => {
        const bread = await insertProduct();
        const roll = await insertProduct();
        const db = getDb();
        await insertReservation(db, {
            items: [
                { productId: bread.id, quantity: 2 },
                { productId: roll.id, quantity: 7 },
            ],
        });
        await insertReservation(db, {
            date: OTHER_DATE,
            items: [{ productId: bread.id, quantity: 9 }],
        });

        const committed = await getCommittedQuantities(db, DATE, [bread.id, roll.id]);

        expect(committed.get(bread.id)).toEqual({ activeReserved: 2, retainedCancelled: 0 });
        expect(committed.get(roll.id)).toEqual({ activeReserved: 7, retainedCancelled: 0 });
    });

    it('returns zeros for products without reservations and nothing for an empty list', async () => {
        const unknownId = randomUUID();

        const committed = await getCommittedQuantities(getDb(), DATE, [unknownId]);

        expect(committed.get(unknownId)).toEqual({ activeReserved: 0, retainedCancelled: 0 });
        expect((await getCommittedQuantities(getDb(), DATE, [])).size).toBe(0);
    });

    it('includes a competing reservation committed while waiting for the plan lock', async () => {
        const bread = await insertProduct();
        let releaseHolder = () => {};
        const holderMayCommit = new Promise<void>((resolve) => (releaseHolder = resolve));
        let signalLocked = () => {};
        const holderLocked = new Promise<void>((resolve) => (signalLocked = resolve));

        const holder = getDb().transaction(async (tx) => {
            await lockDailyPlans(tx, DATE, [bread.id]);
            await insertReservation(tx, { items: [{ productId: bread.id, quantity: 3 }] });
            signalLocked();
            await holderMayCommit;
        });

        try {
            await holderLocked;
            const waiter = getDb().transaction(async (tx) => {
                await lockDailyPlans(tx, DATE, [bread.id]);
                return getCommittedQuantities(tx, DATE, [bread.id]);
            });

            await delay(100);
            releaseHolder();
            await holder;

            expect((await waiter).get(bread.id)).toEqual({
                activeReserved: 3,
                retainedCancelled: 0,
            });
        } finally {
            releaseHolder();
            await holder.catch(() => {});
        }
    });
});
