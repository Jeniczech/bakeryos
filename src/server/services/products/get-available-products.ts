import { and, asc, eq, inArray } from 'drizzle-orm';
import { isValidCalendarDate } from '@/lib/date-time/prague';
import { getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { dailyProductPlans, productWeekdays, products } from '@/server/db/schema';
import { getRemainingAvailability } from '@/server/domain/availability';
import { PickupDateUnavailableError } from '@/server/domain/errors';
import { checkProductOffered, getOnlineCutoff } from '@/server/domain/reservation-rules';
import { assertPickupDateAvailable } from '../eligibility';

export type AvailableProduct = {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number; // haléře
    remainingQuantity: number;
};

export type ProductCatalog = {
    pickupDate: string;
    orderingCutoff: Date;
    products: AvailableProduct[];
};

/**
 * The online catalog for a pickup date: active products offered that weekday, with their
 * remaining quantity. Informational only, so nothing is locked and no daily plan is
 * created; dates without a plan use the products' current defaults (TDD §5.3).
 * `createReservation` rechecks everything transactionally. `now` is injectable for tests.
 */
export const getAvailableProducts = async (
    pickupDate: string,
    options: { now?: Date } = {},
): Promise<ProductCatalog> => {
    if (!isValidCalendarDate(pickupDate)) {
        throw new PickupDateUnavailableError('INVALID_DATE');
    }
    const db = getDb();
    await assertPickupDateAvailable(db, pickupDate, 'online', options.now ?? new Date());

    const rows = await db
        .select({
            id: products.id,
            name: products.name,
            description: products.description,
            imageUrl: products.imageUrl,
            price: products.price,
            capacity: dailyProductPlans.capacity,
            walkInQuantity: dailyProductPlans.walkInQuantity,
            defaultCapacity: products.defaultCapacity,
            defaultWalkInQuantity: products.defaultWalkInQuantity,
        })
        .from(products)
        .leftJoin(
            dailyProductPlans,
            and(
                eq(dailyProductPlans.productId, products.id),
                eq(dailyProductPlans.date, pickupDate),
            ),
        )
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
    const offered = rows.filter((row) => {
        const weekdays = weekdayRows
            .filter((weekdayRow) => weekdayRow.productId === row.id)
            .map((weekdayRow) => weekdayRow.weekday);
        return checkProductOffered({ active: true, weekdays }, pickupDate).ok;
    });
    const committed = await getCommittedQuantities(
        db,
        pickupDate,
        offered.map((row) => row.id),
    );

    return {
        pickupDate,
        orderingCutoff: getOnlineCutoff(pickupDate),
        products: offered.map((row) => {
            const quantities = committed.get(row.id) ?? { activeReserved: 0, retainedCancelled: 0 };
            const remaining = getRemainingAvailability({
                capacity: row.capacity ?? row.defaultCapacity,
                walkInQuantity: row.walkInQuantity ?? row.defaultWalkInQuantity,
                ...quantities,
            });
            return {
                id: row.id,
                name: row.name,
                description: row.description,
                imageUrl: row.imageUrl,
                price: row.price,
                remainingQuantity: Math.max(0, remaining),
            };
        }),
    };
};
