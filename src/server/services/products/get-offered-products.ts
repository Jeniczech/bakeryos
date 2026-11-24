import { asc, eq, inArray } from 'drizzle-orm';
import { isValidCalendarDate } from '@/lib/date-time/prague';
import { getDb, type DbExecutor } from '@/server/db/client';
import { productWeekdays, products } from '@/server/db/schema';
import { checkProductOffered } from '@/server/domain/reservation-rules';
import { groupWeekdaysByProduct, isBakeryOpenOn } from '../eligibility';

export type CatalogProduct = {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number; // haléře
};

type OfferedProductRow = CatalogProduct & {
    defaultCapacity: number;
    defaultWalkInQuantity: number;
};

/** Active products offered on the pickup date's weekday, ordered by name. */
export const listOfferedProducts = async (
    db: DbExecutor,
    pickupDate: string,
): Promise<OfferedProductRow[]> => {
    const rows = await db
        .select({
            id: products.id,
            name: products.name,
            description: products.description,
            imageUrl: products.imageUrl,
            price: products.price,
            defaultCapacity: products.defaultCapacity,
            defaultWalkInQuantity: products.defaultWalkInQuantity,
        })
        .from(products)
        .where(eq(products.active, true))
        .orderBy(asc(products.name), asc(products.id));
    const ids = rows.map((row) => row.id);
    const weekdayRows =
        ids.length > 0
            ? await db
                  .select({
                      productId: productWeekdays.productId,
                      weekday: productWeekdays.weekday,
                  })
                  .from(productWeekdays)
                  .where(inArray(productWeekdays.productId, ids))
            : [];
    const weekdaysByProduct = groupWeekdaysByProduct(weekdayRows);
    return rows.filter(
        (row) =>
            checkProductOffered(
                { active: true, weekdays: weekdaysByProduct.get(row.id) ?? [] },
                pickupDate,
            ).ok,
    );
};

/**
 * The products a pickup date offers, or `null` for an invalid date or a closed day. Independent
 * of the current time, so it is safe to cache: callers check the booking window and cutoff,
 * and availability comes from `getAvailableProducts`.
 */
export const getOfferedProducts = async (pickupDate: string): Promise<CatalogProduct[] | null> => {
    const db = getDb();
    if (!isValidCalendarDate(pickupDate) || !(await isBakeryOpenOn(db, pickupDate))) {
        return null;
    }
    const rows = await listOfferedProducts(db, pickupDate);
    return rows.map(({ id, name, description, imageUrl, price }) => ({
        id,
        name,
        description,
        imageUrl,
        price,
    }));
};
