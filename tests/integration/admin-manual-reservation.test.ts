import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createManualReservation,
    type ManualReservationInput,
} from '@/app/admin/(dashboard)/reservations/new/actions';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';

const session = vi.hoisted(() => ({
    current: null as { user: { id: string; email: string } } | null,
}));

// Auth.js and the request-scoped Next.js APIs need a request; the session is injected instead.
vi.mock('@/server/auth/auth', () => ({ auth: async () => session.current }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

// The action reads the clock itself, so `Date` is faked: noon on Tuesday, before the cutoff for
// Wednesday pickup. Far outside any real booking window.
const PICKUP_DATE = '2099-05-13'; // Wednesday
const WEDNESDAY = 3;
const TODAY = '2099-05-12';
const YESTERDAY = '2099-05-11';
const NOW = pragueTimeToInstant(TODAY, 12);
const CUTOFF = pragueTimeToInstant(TODAY, 18);

const createdProductIds: string[] = [];

const insertProduct = async (overrides: Partial<typeof products.$inferInsert> = {}) => {
    const [product] = await getDb()
        .insert(products)
        .values({ name: 'Phone order loaf', price: 4500, defaultCapacity: 40, ...overrides })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

const buildInput = (
    items: ManualReservationInput['items'],
    overrides: Partial<ManualReservationInput> = {},
): ManualReservationInput => ({
    idempotencyKey: randomUUID(),
    pickupDate: PICKUP_DATE,
    customer: { name: 'Jan Novák', phone: '+420 777 123 456' },
    items,
    ...overrides,
});

const readReservations = (productIds: string[]) =>
    getDb()
        .selectDistinct({
            id: reservations.id,
            reservationNumber: reservations.reservationNumber,
            source: reservations.source,
            status: reservations.status,
        })
        .from(reservations)
        .innerJoin(reservationItems, eq(reservationItems.reservationId, reservations.id))
        .where(inArray(reservationItems.productId, productIds));

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: WEDNESDAY, isOpen: true })
        .onConflictDoNothing();
});

beforeEach(() => {
    vi.setSystemTime(NOW);
    session.current = { user: { id: randomUUID(), email: 'admin@example.com' } };
});

afterEach(async () => {
    const productIds = createdProductIds.splice(0);
    if (productIds.length === 0) {
        return;
    }
    const reservationIds = (await readReservations(productIds)).map((row) => row.id);
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
    vi.useRealTimers();
    await closeDb();
});

describe('createManualReservation', () => {
    it('redirects an unauthenticated request to the login page without writing', async () => {
        session.current = null;
        const bread = await insertProduct();

        await expect(
            createManualReservation(buildInput([{ productId: bread.id, quantity: 1 }])),
        ).rejects.toMatchObject({ digest: expect.stringContaining('/admin/login') });
        expect(await readReservations([bread.id])).toHaveLength(0);
    });

    it('books for tomorrow before the cutoff, beyond online quantity limits', async () => {
        const bread = await insertProduct({ price: 4500 });

        const result = await createManualReservation(
            buildInput([{ productId: bread.id, quantity: 25 }]),
        );

        expect(result).toMatchObject({
            ok: true,
            pickupDate: PICKUP_DATE,
            totalPrice: 25 * 4500,
        });
        expect(await readReservations([bread.id])).toEqual([
            expect.objectContaining({ source: 'admin', status: 'confirmed' }),
        ]);
    });

    it('sets the admin source on the server, ignoring one sent by the client', async () => {
        const bread = await insertProduct();
        const input = { ...buildInput([{ productId: bread.id, quantity: 1 }]), source: 'online' };

        await expect(createManualReservation(input)).resolves.toMatchObject({ ok: true });
        expect(await readReservations([bread.id])).toEqual([
            expect.objectContaining({ source: 'admin' }),
        ]);
    });

    it('still enforces capacity, rejecting the whole reservation', async () => {
        const bread = await insertProduct({ defaultCapacity: 5, defaultWalkInQuantity: 2 });
        const roll = await insertProduct({ name: 'Phone order roll' });

        const result = await createManualReservation(
            buildInput([
                { productId: bread.id, quantity: 4 },
                { productId: roll.id, quantity: 1 },
            ]),
        );

        expect(result).toEqual({
            ok: false,
            error: 'INSUFFICIENT_CAPACITY',
            shortages: [{ productId: bread.id, requested: 4, available: 3 }],
        });
        expect(await readReservations([bread.id, roll.id])).toHaveLength(0);
    });

    it('rejects a late call at the cutoff, like an online reservation', async () => {
        vi.setSystemTime(CUTOFF);
        const bread = await insertProduct();

        const result = await createManualReservation(
            buildInput([{ productId: bread.id, quantity: 1 }]),
        );

        expect(result).toEqual({ ok: false, error: 'CUTOFF_PASSED' });
        expect(await readReservations([bread.id])).toHaveLength(0);
    });

    it.each([
        ['today', TODAY],
        ['a past date', YESTERDAY],
    ])('rejects pickup %s', async (_label, pickupDate) => {
        const bread = await insertProduct();

        const result = await createManualReservation(
            buildInput([{ productId: bread.id, quantity: 1 }], { pickupDate }),
        );

        expect(result).toEqual({ ok: false, error: 'OUTSIDE_BOOKING_WINDOW' });
        expect(await readReservations([bread.id])).toHaveLength(0);
    });

    it('returns the original reservation for a retry with the same key', async () => {
        const bread = await insertProduct();
        const input = buildInput([{ productId: bread.id, quantity: 2 }]);

        const first = await createManualReservation(input);
        const retry = await createManualReservation(input);

        expect(first).toMatchObject({ ok: true });
        expect(retry).toEqual(first);
        expect(await readReservations([bread.id])).toHaveLength(1);
    });

    it('reports which form fields are invalid', async () => {
        const result = await createManualReservation(
            buildInput([], { customer: { name: ' ', phone: '123' } }),
        );

        expect(result).toEqual({
            ok: false,
            error: 'INVALID_REQUEST',
            fields: expect.arrayContaining(['customer.name', 'customer.phone', 'items']),
        });
    });
});
