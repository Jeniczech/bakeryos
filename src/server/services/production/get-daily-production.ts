import { and, eq, inArray } from 'drizzle-orm';
import { calendarDateSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { dailyProductPlans, products, reservationItems, reservations } from '@/server/db/schema';
import { InvalidRequestError, toValidationIssues } from '@/server/domain/errors';
import { buildDailyProductionItem, type DailyProductionItem } from '@/server/domain/production';
import type { PlanDateRejectionReason } from '@/server/domain/reservation-rules';
import { getPlanDateRejection, isBakeryOpenOn } from '../eligibility';
import { listOfferedProducts } from '../products/get-offered-products';

export type DailyProductionRow = DailyProductionItem & {
    active: boolean;
    /** Whether `updateDailyPlan` would accept an override for this product right now. */
    editable: boolean;
};

export type DailyProduction = {
    date: string;
    /** Why no plan on this date can be changed now, or `null` when the date is editable. */
    planDateRejection: PlanDateRejectionReason | null;
    rows: DailyProductionRow[];
};

type ProductRow = {
    id: string;
    name: string;
    active: boolean;
    defaultCapacity: number;
    defaultWalkInQuantity: number;
};

const compareByName = (a: ProductRow, b: ProductRow) =>
    a.name.localeCompare(b.name, 'cs') || a.id.localeCompare(b.id);

/**
 * The production overview for a date: every product offered that day, plus any product with
 * reservations on it (e.g. deactivated since, or no longer offered on that weekday). Dates
 * without a stored plan use the products' current defaults, as the catalog does; nothing is
 * locked or materialized. Past dates are readable but not editable. `now` is injectable for
 * tests. Callers must authorize the administrator.
 */
export const getDailyProduction = async (
    date: string,
    options: { now?: Date } = {},
): Promise<DailyProduction> => {
    const parsedDate = calendarDateSchema.safeParse(date);
    if (!parsedDate.success) {
        throw new InvalidRequestError(toValidationIssues(parsedDate.error));
    }
    const productionDate = parsedDate.data;
    const now = options.now ?? new Date();
    const db = getDb();

    // Pool queries, so the lookups run concurrently on separate connections.
    const [isOpen, offered, reserved, planDateRejection] = await Promise.all([
        isBakeryOpenOn(db, productionDate),
        listOfferedProducts(db, productionDate),
        db
            .selectDistinct({ productId: reservationItems.productId })
            .from(reservationItems)
            .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
            .where(eq(reservations.pickupDate, productionDate)),
        getPlanDateRejection(db, productionDate, now),
    ]);
    const offeredRows: ProductRow[] = isOpen
        ? offered.map(({ id, name, defaultCapacity, defaultWalkInQuantity }) => ({
              id,
              name,
              active: true,
              defaultCapacity,
              defaultWalkInQuantity,
          }))
        : [];
    const offeredIds = new Set(offeredRows.map((row) => row.id));
    const otherIds = reserved
        .map((row) => row.productId)
        .filter((productId) => !offeredIds.has(productId));
    const otherRows =
        otherIds.length > 0
            ? await db
                  .select({
                      id: products.id,
                      name: products.name,
                      active: products.active,
                      defaultCapacity: products.defaultCapacity,
                      defaultWalkInQuantity: products.defaultWalkInQuantity,
                  })
                  .from(products)
                  .where(inArray(products.id, otherIds))
            : [];
    const productRows = [...offeredRows, ...otherRows].sort(compareByName);
    const ids = productRows.map((row) => row.id);
    if (ids.length === 0) {
        return { date: productionDate, planDateRejection, rows: [] };
    }

    const [plans, committed] = await Promise.all([
        db
            .select({
                productId: dailyProductPlans.productId,
                capacity: dailyProductPlans.capacity,
                walkInQuantity: dailyProductPlans.walkInQuantity,
            })
            .from(dailyProductPlans)
            .where(
                and(
                    eq(dailyProductPlans.date, productionDate),
                    inArray(dailyProductPlans.productId, ids),
                ),
            ),
        getCommittedQuantities(db, productionDate, ids),
    ]);
    const plansByProduct = new Map(plans.map((plan) => [plan.productId, plan]));

    return {
        date: productionDate,
        planDateRejection,
        rows: productRows.map((row) => {
            const plan = plansByProduct.get(row.id);
            const quantities = committed.get(row.id) ?? { activeReserved: 0, retainedCancelled: 0 };
            return {
                ...buildDailyProductionItem(
                    { productId: row.id, productName: row.name },
                    {
                        capacity: plan?.capacity ?? row.defaultCapacity,
                        walkInQuantity: plan?.walkInQuantity ?? row.defaultWalkInQuantity,
                        ...quantities,
                    },
                ),
                active: row.active,
                editable: planDateRejection === null && offeredIds.has(row.id),
            };
        }),
    };
};
