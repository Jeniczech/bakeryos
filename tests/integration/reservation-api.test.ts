import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as getProducts } from '@/app/api/products/route';
import { GET as getManagedReservation } from '@/app/api/reservations/manage/[token]/route';
import { POST as cancelManagedReservation } from '@/app/api/reservations/manage/[token]/cancel/route';
import { POST as postReservation } from '@/app/api/reservations/route';
import { addDays, getPragueDate, getWeekday } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryClosures,
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    rateLimits,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import { RESERVATION_RATE_LIMIT } from '@/server/services/rate-limit';

// `connection()` needs a Next request scope, which handlers called directly do not have.
vi.mock('next/server', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/server')>()),
    connection: async () => {},
}));

// Route handlers read the real clock, so these tests book a real near-future date. Its
// cutoff is at least a day away, and the test products are deleted afterwards.
const ORIGIN = 'http://bakery.test';
// Not real addresses: only unique rate-limit keys that cleanup can find by prefix.
const TEST_IP_PREFIX = 'test-client-';

let pickupDate = '';
const createdProductIds: string[] = [];

/** The first non-closed day from today+2 on, which is always before its cutoff. */
const findBookableDate = async (): Promise<string> => {
    const closures = new Set(
        (await getDb().select({ date: bakeryClosures.date }).from(bakeryClosures)).map(
            (closure) => closure.date,
        ),
    );
    const today = getPragueDate(new Date());
    for (let offset = 2; offset <= 7; offset++) {
        const date = addDays(today, offset);
        if (!closures.has(date)) {
            return date;
        }
    }
    throw new Error('Every day in the online booking window is closed.');
};

const insertProduct = async (defaultCapacity = 5, name = 'API test loaf') => {
    const [product] = await getDb()
        .insert(products)
        .values({ name, price: 3900, defaultCapacity })
        .returning();
    createdProductIds.push(product.id);
    return product;
};

/** A distinct client IP per test keeps rate-limit counts independent. */
const newClientIp = () => `${TEST_IP_PREFIX}${randomUUID()}`;

const postJson = (body: unknown, clientIp = newClientIp()) =>
    postReservation(
        new Request(`${ORIGIN}/api/reservations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
    );

const reservationBody = (productId: string, quantity = 2, idempotencyKey = randomUUID()) => ({
    idempotencyKey,
    pickupDate,
    customer: { name: 'Jane Doe', phone: '+420 777 123 456' },
    items: [{ productId, quantity }],
});

const tokenContext = (token: string) => ({ params: Promise.resolve({ token }) });

const tokenFromUrl = (managementUrl: string) =>
    new URL(managementUrl).pathname.split('/').at(-1) ?? '';

const getManaged = (token: string) =>
    getManagedReservation(
        new Request(`${ORIGIN}/api/reservations/manage/${token}`),
        tokenContext(token),
    );

const cancelManaged = (token: string) =>
    cancelManagedReservation(
        new Request(`${ORIGIN}/api/reservations/manage/${token}/cancel`, { method: 'POST' }),
        tokenContext(token),
    );

beforeAll(async () => {
    pickupDate = await findBookableDate();
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: getWeekday(pickupDate), isOpen: true })
        .onConflictDoNothing();
});

afterEach(async () => {
    await getDb()
        .delete(rateLimits)
        .where(like(rateLimits.key, `reservations:${TEST_IP_PREFIX}%`));
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
    vi.unstubAllEnvs();
    await closeDb();
});

describe('GET /api/products', () => {
    it('returns the catalog for a bookable date without caching', async () => {
        const product = await insertProduct(7);

        const response = await getProducts(
            new Request(`${ORIGIN}/api/products?date=${pickupDate}`),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const body = await response.json();
        expect(body.pickupDate).toBe(pickupDate);
        expect(body.products).toContainEqual({
            id: product.id,
            name: 'API test loaf',
            description: null,
            imageUrl: null,
            price: 3900,
            remainingQuantity: 7,
        });
    });

    it.each([
        ['a missing date', '', 400, 'INVALID_DATE'],
        ['today, which is outside the online window', 'today', 422, 'OUTSIDE_BOOKING_WINDOW'],
    ])('rejects %s', async (_label, dateParam, status, code) => {
        const date = dateParam === 'today' ? getPragueDate(new Date()) : dateParam;
        const query = date ? `?date=${date}` : '';

        const response = await getProducts(new Request(`${ORIGIN}/api/products${query}`));

        expect(response.status).toBe(status);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json');
        expect(await response.json()).toMatchObject({ status, code });
    });
});

describe('POST /api/reservations', () => {
    it('creates a reservation, then replays it for the same idempotency key', async () => {
        const product = await insertProduct();
        const body = reservationBody(product.id);

        const created = await postJson(body);
        const replayed = await postJson(body);

        expect(created.status).toBe(201);
        expect(created.headers.get('Cache-Control')).toBe('no-store');
        const confirmation = await created.json();
        expect(confirmation).toMatchObject({
            pickupDate,
            status: 'confirmed',
            totalPrice: 7800,
            items: [
                {
                    productId: product.id,
                    productName: 'API test loaf',
                    unitPrice: 3900,
                    quantity: 2,
                },
            ],
        });
        expect(confirmation.reservationNumber).toMatch(/^BK-\d{6}$/);
        expect(confirmation.managementUrl).toMatch(
            new RegExp(`^${ORIGIN}/reservations/manage/[A-Za-z0-9_-]{43}$`),
        );
        expect(replayed.status).toBe(200);
        expect(await replayed.json()).toEqual(confirmation);
    });

    it('lists items in the same order on creation, replay, and the management endpoint', async () => {
        // Name order is chosen to differ from ID order whichever IDs are generated.
        const [first, second] = [
            await insertProduct(5, 'API test A'),
            await insertProduct(5, 'API test B'),
        ];
        const [high, low] = first.id > second.id ? [first, second] : [second, first];
        await getDb().update(products).set({ name: 'API test A' }).where(eq(products.id, high.id));
        await getDb().update(products).set({ name: 'API test B' }).where(eq(products.id, low.id));
        const body = {
            ...reservationBody(low.id, 1),
            items: [
                { productId: low.id, quantity: 1 },
                { productId: high.id, quantity: 1 },
            ],
        };

        const created = await (await postJson(body)).json();
        const replayed = await (await postJson(body)).json();
        const managed = await (await getManaged(tokenFromUrl(created.managementUrl))).json();

        const names = (items: { productName: string }[]) => items.map((item) => item.productName);
        expect(names(created.items)).toEqual(['API test A', 'API test B']);
        expect(replayed.items).toEqual(created.items);
        expect(managed.items).toEqual(created.items);
    });

    it('builds the management URL from APP_URL when it is set', async () => {
        vi.stubEnv('APP_URL', 'https://bakery.example/');
        const product = await insertProduct();

        const response = await postJson(reservationBody(product.id));
        vi.unstubAllEnvs();

        const { managementUrl } = await response.json();
        expect(managementUrl).toMatch(
            /^https:\/\/bakery\.example\/reservations\/manage\/[A-Za-z0-9_-]{43}$/,
        );
    });

    it('always stores public reservations as online, ignoring a client-supplied source', async () => {
        const product = await insertProduct();

        const response = await postJson({ ...reservationBody(product.id), source: 'admin' });

        expect(response.status).toBe(201);
        const { reservationNumber } = await response.json();
        const [stored] = await getDb()
            .select({ source: reservations.source })
            .from(reservations)
            .where(eq(reservations.reservationNumber, reservationNumber));
        expect(stored.source).toBe('online');
    });

    it('ignores client-supplied prices', async () => {
        const product = await insertProduct();
        const body = reservationBody(product.id, 1);

        const response = await postJson({
            ...body,
            items: [{ ...body.items[0], unitPrice: 1 }],
            totalPrice: 1,
        });

        expect(await response.json()).toMatchObject({ totalPrice: 3900 });
    });

    it('returns 409 with the shortage when capacity is insufficient', async () => {
        const product = await insertProduct(1);

        const response = await postJson(reservationBody(product.id, 2));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
            code: 'INSUFFICIENT_CAPACITY',
            shortages: [{ productId: product.id, requested: 2, available: 1 }],
        });
    });

    it('returns 409 when an idempotency key is reused for a different request', async () => {
        const product = await insertProduct();
        const key = randomUUID();
        await postJson(reservationBody(product.id, 1, key));

        const response = await postJson(reservationBody(product.id, 2, key));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    });

    it('returns 422 when the online quantity limit is exceeded', async () => {
        const product = await insertProduct(100);

        const response = await postJson(reservationBody(product.id, 21));

        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ code: 'PRODUCT_LIMIT_EXCEEDED', limit: 20 });
    });

    it.each([
        ['malformed JSON', '{"idempotencyKey":'],
        ['a JSON body that is not an object', '[1, 2]'],
        ['an invalid phone number', { phone: '12' }],
    ])('returns 400 for %s', async (_label, payload) => {
        const product = await insertProduct();
        const body =
            typeof payload === 'string'
                ? payload
                : { ...reservationBody(product.id), customer: { name: 'Jane', ...payload } };

        const response = await postJson(body);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it('returns 429 with Retry-After once a client exceeds the limit', async () => {
        const clientIp = newClientIp();
        for (let attempt = 0; attempt < RESERVATION_RATE_LIMIT.limit; attempt++) {
            expect((await postJson('{}', clientIp)).status).toBe(400);
        }

        const limited = await postJson('{}', clientIp);
        const otherClient = await postJson('{}');

        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
        expect(otherClient.status).toBe(400);
    });
});

describe('reservation management', () => {
    const createReservationViaApi = async (productId: string) => {
        const response = await postJson(reservationBody(productId));
        const { managementUrl } = await response.json();
        return tokenFromUrl(managementUrl);
    };

    it('returns the reservation for its token, without the phone number', async () => {
        const product = await insertProduct();
        const token = await createReservationViaApi(product.id);

        const response = await getManaged(token);

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const body = await response.json();
        expect(body).toMatchObject({
            pickupDate,
            status: 'confirmed',
            customerName: 'Jane Doe',
            totalPrice: 7800,
            canCancel: true,
        });
        expect(JSON.stringify(body)).not.toContain('777');
        expect(body).not.toHaveProperty('reservationId');
    });

    it('returns the same 404 for malformed and unknown tokens', async () => {
        const malformed = await getManaged('nope');
        const unknown = await getManaged('A'.repeat(43));

        expect(malformed.status).toBe(404);
        expect(unknown.status).toBe(404);
        expect(await malformed.json()).toEqual(await unknown.json());
    });

    it('cancels before the cutoff, releasing capacity, and repeats without side effects', async () => {
        const product = await insertProduct(2);
        const token = await createReservationViaApi(product.id);

        const cancelled = await cancelManaged(token);
        const repeated = await cancelManaged(token);
        const rebooked = await postJson(reservationBody(product.id, 2));

        expect(cancelled.status).toBe(200);
        expect(await cancelled.json()).toMatchObject({ status: 'cancelled', canCancel: false });
        expect(repeated.status).toBe(200);
        expect(await repeated.json()).toMatchObject({ status: 'cancelled' });
        expect(rebooked.status).toBe(201);
    });

    it('returns 404 when cancelling with an unknown token', async () => {
        const response = await cancelManaged('A'.repeat(43));

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'RESERVATION_NOT_FOUND' });
    });
});
