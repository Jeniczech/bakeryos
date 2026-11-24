import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import { ReservationNotFoundError, StatusTransitionError } from '@/server/domain/errors';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';
import { createReservation } from '@/server/services/reservations/create-reservation';
import { getReservationByToken } from '@/server/services/reservations/get-reservation';
import { deriveManagementToken } from '@/server/services/reservations/management-token';

// Far outside any real booking window; the clock is injected relative to this date.
const PICKUP_DATE = '2099-09-16'; // Wednesday
const WEDNESDAY = 3;
const BEFORE_CUTOFF = pragueTimeToInstant('2099-09-15', 12);
const CUTOFF = pragueTimeToInstant('2099-09-15', 18);
const AFTER_CUTOFF = pragueTimeToInstant('2099-09-16', 9);

const createdProductIds: string[] = [];

const insertProduct = async (defaultCapacity = 5) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Cancellation test loaf', price: 5000, defaultCapacity })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const reserve = (productId: string, quantity: number) =>
    createReservation(
        {
            idempotencyKey: randomUUID(),
            pickupDate: PICKUP_DATE,
            customer: { name: 'Jane Doe', phone: '+420777123456' },
            items: [{ productId, quantity }],
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

const readCommitted = async (productId: string) =>
    (await getCommittedQuantities(getDb(), PICKUP_DATE, [productId])).get(productId);

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
    await closeDb();
});

describe('getReservationByToken', () => {
    it('returns the reservation details without the phone number', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 2);

        const details = await getReservationByToken(created.managementToken, {
            now: BEFORE_CUTOFF,
        });

        expect(details).toEqual({
            reservationId: created.reservationId,
            reservationNumber: created.reservationNumber,
            pickupDate: PICKUP_DATE,
            status: 'confirmed',
            customerName: 'Jane Doe',
            totalPrice: 10000,
            items: [
                {
                    productId: product.id,
                    productName: 'Cancellation test loaf',
                    unitPrice: 5000,
                    quantity: 2,
                },
            ],
            cancellationCutoff: CUTOFF,
            canCancel: true,
        });
    });

    it('reports that the customer can no longer cancel at the cutoff', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 1);

        const details = await getReservationByToken(created.managementToken, { now: CUTOFF });

        expect(details.canCancel).toBe(false);
    });

    it.each([
        ['malformed', 'not-a-token'],
        ['unknown', deriveManagementToken(randomUUID())],
    ])('rejects a %s token as not found', async (_label, token) => {
        await expect(getReservationByToken(token)).rejects.toBeInstanceOf(ReservationNotFoundError);
    });
});

describe('cancelReservation', () => {
    it('lets a customer cancel before the cutoff and releases the capacity', async () => {
        const product = await insertProduct(3);
        const created = await reserve(product.id, 3);

        const details = await cancelReservation(
            { actor: 'customer', token: created.managementToken },
            { now: BEFORE_CUTOFF },
        );

        expect(details).toMatchObject({ status: 'cancelled', canCancel: false });
        expect(await readReservation(created.reservationId)).toMatchObject({
            status: 'cancelled',
            retainForProduction: false,
            cancelledAt: BEFORE_CUTOFF,
        });
        expect(await readCommitted(product.id)).toEqual({
            activeReserved: 0,
            retainedCancelled: 0,
        });
        await expect(reserve(product.id, 3)).resolves.toMatchObject({ status: 'confirmed' });
    });

    it('rejects a customer cancellation at the exact cutoff', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 2);

        const attempt = cancelReservation(
            { actor: 'customer', token: created.managementToken },
            { now: CUTOFF },
        );

        await expect(attempt).rejects.toBeInstanceOf(StatusTransitionError);
        await expect(attempt).rejects.toMatchObject({ code: 'CUTOFF_PASSED' });
        expect(await readReservation(created.reservationId)).toMatchObject({
            status: 'confirmed',
            cancelledAt: null,
        });
    });

    it('keeps the production commitment when an admin cancels after the cutoff', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 2);

        await cancelReservation(
            { actor: 'admin', reservationId: created.reservationId },
            { now: AFTER_CUTOFF },
        );

        expect(await readReservation(created.reservationId)).toMatchObject({
            status: 'cancelled',
            retainForProduction: true,
        });
        expect(await readCommitted(product.id)).toEqual({
            activeReserved: 0,
            retainedCancelled: 2,
        });
    });

    it('releases the capacity when an admin cancels before the cutoff', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 2);

        await cancelReservation(
            { actor: 'admin', reservationId: created.reservationId },
            { now: BEFORE_CUTOFF },
        );

        expect(await readReservation(created.reservationId)).toMatchObject({
            retainForProduction: false,
        });
        expect(await readCommitted(product.id)).toEqual({
            activeReserved: 0,
            retainedCancelled: 0,
        });
    });

    it('returns the cancelled state on a repeated cancellation without changing anything', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 2);
        const token = created.managementToken;
        await cancelReservation({ actor: 'customer', token }, { now: BEFORE_CUTOFF });

        // After the cutoff: a retry still succeeds instead of reporting the cutoff.
        const repeated = await cancelReservation(
            { actor: 'customer', token },
            { now: AFTER_CUTOFF },
        );
        await cancelReservation(
            { actor: 'admin', reservationId: created.reservationId },
            { now: AFTER_CUTOFF },
        );

        expect(repeated.status).toBe('cancelled');
        expect(await readReservation(created.reservationId)).toMatchObject({
            status: 'cancelled',
            retainForProduction: false,
            cancelledAt: BEFORE_CUTOFF,
        });
    });

    it('rejects cancelling a reservation that was already picked up', async () => {
        const product = await insertProduct();
        const created = await reserve(product.id, 1);
        await getDb()
            .update(reservations)
            .set({ status: 'picked_up' })
            .where(eq(reservations.id, created.reservationId));

        await expect(
            cancelReservation(
                { actor: 'admin', reservationId: created.reservationId },
                { now: AFTER_CUTOFF },
            ),
        ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect((await readReservation(created.reservationId)).status).toBe('picked_up');
    });

    it.each([
        ['customer with an unknown token', { actor: 'customer', token: 'x'.repeat(43) }],
        ['admin with a malformed ID', { actor: 'admin', reservationId: 'not-a-uuid' }],
        ['admin with an unknown ID', { actor: 'admin', reservationId: randomUUID() }],
    ] as const)('rejects a %s as not found', async (_label, input) => {
        await expect(cancelReservation(input)).rejects.toBeInstanceOf(ReservationNotFoundError);
    });
});
