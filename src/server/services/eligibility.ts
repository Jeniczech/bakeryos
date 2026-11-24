import { eq, inArray } from 'drizzle-orm';
import { isValidCalendarDate } from '@/lib/date-time/prague';
import type { DbExecutor } from '@/server/db/client';
import { bakeryClosures, bakeryOpeningDays, productWeekdays, products } from '@/server/db/schema';
import {
    PickupDateUnavailableError,
    ProductUnavailableError,
    type UnavailableProduct,
} from '@/server/domain/errors';
import {
    checkPickupDate,
    checkProductOffered,
    type BakerySchedule,
    type ReservationSource,
} from '@/server/domain/reservation-rules';

export type OfferedProduct = { id: string; name: string; price: number };

const loadSchedule = async (db: DbExecutor, date: string): Promise<BakerySchedule> => {
    const openDays = await db
        .select({ weekday: bakeryOpeningDays.weekday })
        .from(bakeryOpeningDays)
        .where(eq(bakeryOpeningDays.isOpen, true));
    const closures = await db
        .select({ date: bakeryClosures.date })
        .from(bakeryClosures)
        .where(eq(bakeryClosures.date, date));
    return {
        openWeekdays: new Set(openDays.map((day) => day.weekday)),
        closures: new Set(closures.map((closure) => closure.date)),
    };
};

export const groupWeekdaysByProduct = (
    rows: readonly { productId: string; weekday: number }[],
): Map<string, number[]> => {
    const weekdaysByProduct = new Map<string, number[]>();
    for (const { productId, weekday } of rows) {
        const weekdays = weekdaysByProduct.get(productId) ?? [];
        weekdays.push(weekday);
        weekdaysByProduct.set(productId, weekdays);
    }
    return weekdaysByProduct;
};

/** Rejects dates outside the source's booking window, after its cutoff, or on closed days. */
export const assertPickupDateAvailable = async (
    db: DbExecutor,
    pickupDate: string,
    source: ReservationSource,
    now: Date,
): Promise<void> => {
    // Checked before querying, where an impossible date would fail as a SQL error.
    if (!isValidCalendarDate(pickupDate)) {
        throw new PickupDateUnavailableError('INVALID_DATE');
    }
    const schedule = await loadSchedule(db, pickupDate);
    const dateCheck = checkPickupDate({ pickupDate, source, now, schedule });
    if (!dateCheck.ok) {
        throw new PickupDateUnavailableError(dateCheck.reason);
    }
};

/** Returns the products in the order of `productIds`, or rejects every unavailable one at once. */
export const loadOfferedProducts = async (
    db: DbExecutor,
    productIds: readonly string[],
    pickupDate: string,
): Promise<OfferedProduct[]> => {
    const rows = await db
        .select({
            id: products.id,
            name: products.name,
            price: products.price,
            active: products.active,
        })
        .from(products)
        .where(inArray(products.id, [...productIds]));
    const weekdayRows = await db
        .select({ productId: productWeekdays.productId, weekday: productWeekdays.weekday })
        .from(productWeekdays)
        .where(inArray(productWeekdays.productId, [...productIds]));

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const weekdaysByProduct = groupWeekdaysByProduct(weekdayRows);
    const offered: OfferedProduct[] = [];
    const unavailable: UnavailableProduct[] = [];
    for (const productId of productIds) {
        const row = rowsById.get(productId);
        if (!row) {
            unavailable.push({ productId, reason: 'PRODUCT_NOT_FOUND' });
            continue;
        }
        const weekdays = weekdaysByProduct.get(productId) ?? [];
        const check = checkProductOffered({ active: row.active, weekdays }, pickupDate);
        if (check.ok) {
            offered.push({ id: row.id, name: row.name, price: row.price });
        } else {
            unavailable.push({ productId, reason: check.reason });
        }
    }
    if (unavailable.length > 0) {
        throw new ProductUnavailableError(unavailable);
    }
    return offered;
};
