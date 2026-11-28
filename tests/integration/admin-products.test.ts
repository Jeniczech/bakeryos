import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { updateTag } from 'next/cache';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createProductAction,
    updateProductAction,
    type ProductFormState,
    type ProductFormValues,
} from '@/app/admin/(dashboard)/products/actions';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import {
    bakeryOpeningDays,
    dailyProductPlans,
    products,
    reservationItems,
    reservations,
} from '@/server/db/schema';
import {
    InvalidRequestError,
    ProductChangedError,
    ProductNotFoundError,
    ProductUnavailableError,
} from '@/server/domain/errors';
import { getOfferedProducts } from '@/server/services/products/get-offered-products';
import { getProduct } from '@/server/services/products/admin-products';
import { updateProduct } from '@/server/services/products/update-product';
import { createReservation } from '@/server/services/reservations/create-reservation';

const session = vi.hoisted(() => ({
    current: null as { user: { id: string; email: string } } | null,
}));

// Auth.js and the request-scoped Next.js APIs need a request; the session is injected instead.
vi.mock('@/server/auth/auth', () => ({ auth: async () => session.current }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/cache', () => ({ updateTag: vi.fn() }));

// Far outside any real booking window: noon on Tuesday, before the cutoff for Wednesday.
const PICKUP_DATE = '2099-05-13'; // Wednesday
const WEDNESDAY = 3;
const NOW = pragueTimeToInstant('2099-05-12', 12);

const TEST_PRODUCT_PREFIX = 'Product admin test';

const INITIAL_STATE: ProductFormState = {
    error: null,
    fields: [],
    values: {
        name: '',
        description: '',
        imageUrl: '',
        price: '',
        defaultCapacity: '',
        defaultWalkInQuantity: '',
        active: true,
    },
};

const validValues = (overrides: Partial<ProductFormValues> = {}): ProductFormValues => ({
    name: `${TEST_PRODUCT_PREFIX} rye`,
    description: 'Sourdough rye',
    imageUrl: 'https://example.com/rye.jpg',
    price: '45,50',
    defaultCapacity: '40',
    defaultWalkInQuantity: '5',
    active: true,
    ...overrides,
});

const toFormData = (values: ProductFormValues, product?: { id: string; version: string }) => {
    const formData = new FormData();
    for (const [field, value] of Object.entries(values)) {
        if (field === 'active') {
            if (value) {
                formData.set('active', 'on');
            }
        } else {
            formData.set(field, String(value));
        }
    }
    if (product) {
        formData.set('productId', product.id);
        formData.set('version', product.version);
    }
    return formData;
};

const insertProduct = async (overrides: Partial<typeof products.$inferInsert> = {}) => {
    const [product] = await getDb()
        .insert(products)
        .values({
            name: `${TEST_PRODUCT_PREFIX} loaf`,
            price: 3000,
            defaultCapacity: 10,
            ...overrides,
        })
        .returning();
    const loaded = await getProduct(product.id);
    if (!loaded) {
        throw new Error('The inserted product was not found.');
    }
    return loaded;
};

const readProduct = async (productId: string) => {
    const [row] = await getDb().select().from(products).where(eq(products.id, productId));
    return row;
};

const readTestProducts = () =>
    getDb()
        .select()
        .from(products)
        .where(like(products.name, `${TEST_PRODUCT_PREFIX}%`));

const reserve = (productId: string) =>
    createReservation(
        {
            idempotencyKey: randomUUID(),
            pickupDate: PICKUP_DATE,
            customer: { name: 'Jan Novák', phone: '+420777123456' },
            items: [{ productId, quantity: 2 }],
            source: 'admin',
        },
        { now: NOW },
    );

/** A rejected redirect carries its target in the digest. */
const expectRedirectTo = (promise: Promise<unknown>, path: string) =>
    expect(promise).rejects.toMatchObject({ digest: expect.stringContaining(path) });

beforeAll(async () => {
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: WEDNESDAY, isOpen: true })
        .onConflictDoNothing();
});

beforeEach(() => {
    vi.mocked(updateTag).mockClear();
    session.current = { user: { id: randomUUID(), email: 'admin@example.com' } };
});

afterEach(async () => {
    const testIds = (await readTestProducts()).map((row) => row.id);
    if (testIds.length === 0) {
        return;
    }
    const reservationIds = (
        await getDb()
            .selectDistinct({ id: reservationItems.reservationId })
            .from(reservationItems)
            .where(inArray(reservationItems.productId, testIds))
    ).map((row) => row.id);
    if (reservationIds.length > 0) {
        await getDb()
            .delete(reservationItems)
            .where(inArray(reservationItems.reservationId, reservationIds));
        await getDb().delete(reservations).where(inArray(reservations.id, reservationIds));
    }
    await getDb().delete(dailyProductPlans).where(inArray(dailyProductPlans.productId, testIds));
    await getDb().delete(products).where(inArray(products.id, testIds));
});

afterAll(async () => {
    await closeDb();
});

describe('createProductAction', () => {
    it('redirects an unauthenticated request to the login page without writing', async () => {
        session.current = null;

        await expectRedirectTo(
            createProductAction(INITIAL_STATE, toFormData(validValues())),
            '/admin/login',
        );
        expect(await readTestProducts()).toEqual([]);
        expect(updateTag).not.toHaveBeenCalled();
    });

    it('creates the product, invalidates the catalog and returns to the list', async () => {
        await expectRedirectTo(
            createProductAction(INITIAL_STATE, toFormData(validValues())),
            '/admin/products',
        );

        expect(await readTestProducts()).toEqual([
            expect.objectContaining({
                name: `${TEST_PRODUCT_PREFIX} rye`,
                description: 'Sourdough rye',
                imageUrl: 'https://example.com/rye.jpg',
                price: 4550,
                defaultCapacity: 40,
                defaultWalkInQuantity: 5,
                active: true,
            }),
        ]);
        expect(updateTag).toHaveBeenCalledWith('catalog');
    });

    it('returns invalid fields with the submitted values and writes nothing', async () => {
        const values = validValues({
            price: '12,345',
            defaultCapacity: '3',
            defaultWalkInQuantity: '4',
            imageUrl: 'javascript:alert(1)',
        });

        await expect(createProductAction(INITIAL_STATE, toFormData(values))).resolves.toEqual({
            error: 'INVALID_REQUEST',
            fields: ['imageUrl', 'price', 'defaultWalkInQuantity'],
            values,
        });
        expect(await readTestProducts()).toEqual([]);
        expect(updateTag).not.toHaveBeenCalled();
    });

    it('rejects a name another product has, ignoring case, even when that one is inactive', async () => {
        const existing = await insertProduct({ active: false });
        const values = validValues({ name: ` ${TEST_PRODUCT_PREFIX} LOAF ` });

        await expect(createProductAction(INITIAL_STATE, toFormData(values))).resolves.toEqual({
            error: 'NAME_TAKEN',
            fields: ['name'],
            values,
        });
        expect((await readTestProducts()).map((row) => row.id)).toEqual([existing.id]);
        expect(updateTag).not.toHaveBeenCalled();
    });
});

describe('updateProductAction', () => {
    it('redirects an unauthenticated request to the login page without writing', async () => {
        session.current = null;
        const product = await insertProduct();

        await expectRedirectTo(
            updateProductAction(INITIAL_STATE, toFormData(validValues({ active: false }), product)),
            '/admin/login',
        );
        expect(await readProduct(product.id)).toMatchObject({
            name: product.name,
            active: true,
        });
    });

    it('deactivates the product when the active box is unchecked', async () => {
        const product = await insertProduct();

        await expectRedirectTo(
            updateProductAction(
                INITIAL_STATE,
                toFormData(validValues({ active: false, imageUrl: '' }), product),
            ),
            '/admin/products',
        );

        expect(await readProduct(product.id)).toMatchObject({
            name: `${TEST_PRODUCT_PREFIX} rye`,
            imageUrl: null,
            price: 4550,
            active: false,
        });
        expect(updateTag).toHaveBeenCalledWith('catalog');
    });

    it.each([randomUUID(), 'not-a-uuid'])('reports an unknown product %s', async (productId) => {
        await expect(
            updateProductAction(
                INITIAL_STATE,
                toFormData(validValues(), { id: productId, version: '1' }),
            ),
        ).resolves.toMatchObject({ error: 'NOT_FOUND' });
        expect(updateTag).not.toHaveBeenCalled();
    });

    it('rejects a form loaded before the last save instead of undoing that save', async () => {
        const product = await insertProduct();
        await expectRedirectTo(
            updateProductAction(
                INITIAL_STATE,
                toFormData(validValues({ name: `${TEST_PRODUCT_PREFIX} renamed` }), product),
            ),
            '/admin/products',
        );
        vi.mocked(updateTag).mockClear();

        const staleValues = validValues({ name: product.name, defaultCapacity: '51' });
        await expect(
            updateProductAction(INITIAL_STATE, toFormData(staleValues, product)),
        ).resolves.toEqual({ error: 'CHANGED', fields: [], values: staleValues });

        expect(await readProduct(product.id)).toMatchObject({
            name: `${TEST_PRODUCT_PREFIX} renamed`,
            defaultCapacity: 40,
        });
        expect(updateTag).not.toHaveBeenCalled();
    });

    it('rejects a rename to the name of another product without writing', async () => {
        await insertProduct({ name: `${TEST_PRODUCT_PREFIX} other` });
        const product = await insertProduct();
        const values = validValues({ name: `${TEST_PRODUCT_PREFIX} OTHER` });

        await expect(
            updateProductAction(INITIAL_STATE, toFormData(values, product)),
        ).resolves.toEqual({ error: 'NAME_TAKEN', fields: ['name'], values });
        expect(await readProduct(product.id)).toMatchObject({ name: product.name });
        expect(updateTag).not.toHaveBeenCalled();
    });

    it('lets a product change the letter case of its own name', async () => {
        const product = await insertProduct();
        const name = `${TEST_PRODUCT_PREFIX} LOAF`;

        await expectRedirectTo(
            updateProductAction(INITIAL_STATE, toFormData(validValues({ name }), product)),
            '/admin/products',
        );
        expect(await readProduct(product.id)).toMatchObject({ name });
    });
});

describe('updateProduct and existing reservations', () => {
    it('keeps the reserved name and price after a rename, price change and deactivation', async () => {
        const product = await insertProduct({ price: 3000 });
        const reservation = await reserve(product.id);

        await updateProduct(
            product.id,
            {
                name: `${TEST_PRODUCT_PREFIX} renamed`,
                price: 9900,
                defaultCapacity: 10,
                defaultWalkInQuantity: 0,
                active: false,
            },
            product.version,
        );

        const items = await getDb()
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.reservationId, reservation.reservationId));
        expect(items).toEqual([
            expect.objectContaining({
                productId: product.id,
                productNameSnapshot: `${TEST_PRODUCT_PREFIX} loaf`,
                unitPriceSnapshot: 3000,
                quantity: 2,
            }),
        ]);
        const [row] = await getDb()
            .select()
            .from(reservations)
            .where(eq(reservations.id, reservation.reservationId));
        expect(row.status).toBe('confirmed');
    });

    it('blocks new reservations and withdraws a deactivated product from the catalog', async () => {
        const product = await insertProduct();
        await updateProduct(
            product.id,
            {
                name: product.name,
                price: product.price,
                defaultCapacity: product.defaultCapacity,
                defaultWalkInQuantity: product.defaultWalkInQuantity,
                active: false,
            },
            product.version,
        );

        await expect(reserve(product.id)).rejects.toBeInstanceOf(ProductUnavailableError);
        const items = await getDb()
            .select()
            .from(reservationItems)
            .where(eq(reservationItems.productId, product.id));
        expect(items).toEqual([]);
        expect((await getOfferedProducts(PICKUP_DATE))?.map((offered) => offered.id)).not.toContain(
            product.id,
        );
    });

    it('rejects an unknown product without writing', async () => {
        await expect(
            updateProduct(
                randomUUID(),
                {
                    name: 'Ghost',
                    price: 100,
                    defaultCapacity: 1,
                    defaultWalkInQuantity: 0,
                    active: true,
                },
                '1',
            ),
        ).rejects.toBeInstanceOf(ProductNotFoundError);
    });

    it('returns a new version on each save and rejects the previous one', async () => {
        const product = await insertProduct();
        const input = {
            name: product.name,
            price: product.price,
            defaultCapacity: 12,
            defaultWalkInQuantity: 0,
            active: true,
        };

        const saved = await updateProduct(product.id, input, product.version);
        expect(saved.version).not.toBe(product.version);
        expect(saved.version).toBe((await getProduct(product.id))?.version);

        await expect(
            updateProduct(product.id, { ...input, defaultCapacity: 13 }, product.version),
        ).rejects.toBeInstanceOf(ProductChangedError);
        expect((await readProduct(product.id)).defaultCapacity).toBe(12);
    });

    it('rejects a malformed version without writing', async () => {
        const product = await insertProduct();

        await expect(
            updateProduct(
                product.id,
                { ...product, defaultCapacity: 99, description: null, imageUrl: null },
                'abc',
            ),
        ).rejects.toBeInstanceOf(InvalidRequestError);
        expect((await readProduct(product.id)).defaultCapacity).toBe(10);
    });
});
