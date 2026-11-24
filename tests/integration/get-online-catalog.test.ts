import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { bakeryClosures, bakeryOpeningDays, productWeekdays, products } from '@/server/db/schema';
import { getOnlineCatalog } from '@/server/services/products/get-online-catalog';

// Far outside any real booking window, and apart from other test files' dates: closures are
// global, and test files run in parallel.
const NOW = pragueTimeToInstant('2097-06-04', 12); // Tuesday noon
const WEDNESDAY = 3;
const THURSDAY = 4;
const OPEN_WEDNESDAY = '2097-06-05';
const CLOSED_THURSDAY = '2097-06-06';

const createdProductIds: string[] = [];

beforeAll(async () => {
    await getDb()
        .insert(bakeryOpeningDays)
        .values([
            { weekday: WEDNESDAY, isOpen: true },
            { weekday: THURSDAY, isOpen: true },
        ])
        .onConflictDoNothing();
});

afterEach(async () => {
    await getDb().delete(bakeryClosures).where(eq(bakeryClosures.date, CLOSED_THURSDAY));
    const productIds = createdProductIds.splice(0);
    if (productIds.length > 0) {
        await getDb().delete(products).where(inArray(products.id, productIds));
    }
});

afterAll(async () => {
    await closeDb();
});

describe('getOnlineCatalog', () => {
    it('loads a catalog for every bookable date in the window and none for closed days', async () => {
        const [product] = await getDb()
            .insert(products)
            .values({ name: 'Window test loaf', price: 4200, defaultCapacity: 6 })
            .returning();
        createdProductIds.push(product.id);
        await getDb()
            .insert(productWeekdays)
            .values([THURSDAY, WEDNESDAY].map((weekday) => ({ productId: product.id, weekday })));
        await getDb()
            .insert(bakeryClosures)
            .values({ date: CLOSED_THURSDAY, reason: 'Online catalog test' });

        const catalog = await getOnlineCatalog({ now: NOW });

        expect(catalog.dates).toHaveLength(7);
        expect(catalog.dates.find((option) => option.date === CLOSED_THURSDAY)).toEqual({
            date: CLOSED_THURSDAY,
            unavailableReason: 'BAKERY_CLOSED',
        });
        const bookable = catalog.dates
            .filter((option) => option.unavailableReason === null)
            .map((option) => option.date);
        expect(Object.keys(catalog.productsByDate).sort()).toEqual(bookable);
        expect(catalog.productsByDate[CLOSED_THURSDAY]).toBeUndefined();
        expect(
            catalog.productsByDate[OPEN_WEDNESDAY].filter((item) => item.id === product.id),
        ).toEqual([
            {
                id: product.id,
                name: 'Window test loaf',
                description: null,
                imageUrl: null,
                price: 4200,
                remainingQuantity: 6,
            },
        ]);
    });
});
