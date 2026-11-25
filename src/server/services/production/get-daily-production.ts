import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { getPragueDate } from '@/lib/date-time/prague';
import { calendarDateSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { dailyProductPlans, products, reservationItems, reservations } from '@/server/db/schema';
import { InvalidRequestError, toValidationIssues } from '@/server/domain/errors';
import { buildDailyProductionItem, type DailyProductionItem } from '@/server/domain/production';
import {
    checkPlanDate,
    isBakeryOpen,
    type BakerySchedule,
} from '@/server/domain/reservation-rules';
import { loadSchedule } from '../eligibility';
import { listOfferedProducts } from '../products/get-offered-products';

/** Why a row is shown but not offered on the date: deactivated, or not on that weekday. */
export type ProductionRowNotice = 'INACTIVE' | 'NOT_OFFERED_ON_DATE';

export type DailyProductionRow = DailyProductionItem & {
    notice: ProductionRowNotice | null;
    /** Whether `updateDailyPlan` would accept an override for this product right now. */
    editable: boolean;
};

/** Why no plan on the date can be changed now, or `null` when the date is editable. */
export type ProductionDateLock = 'BAKERY_CLOSED' | 'PAST_DATE' | 'BEYOND_PLANNING_WINDOW';

export type DailyProduction = {
    date: string;
    dateLock: ProductionDateLock | null;
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

const getDateLock = (
    date: string,
    now: Date,
    schedule: BakerySchedule,
): ProductionDateLock | null => {
    if (!isBakeryOpen(date, schedule)) {
        return 'BAKERY_CLOSED';
    }
    if (date < getPragueDate(now)) {
        return 'PAST_DATE';
    }
    return checkPlanDate({ date, now, schedule }).ok ? null : 'BEYOND_PLANNING_WINDOW';
};

/** Products whose reservations on the date count toward production (TDD §4.2). */
const listCommittedProductIds = async (date: string): Promise<string[]> => {
    const rows = await getDb()
        .selectDistinct({ productId: reservationItems.productId })
        .from(reservationItems)
        .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
        .where(
            and(
                eq(reservations.pickupDate, date),
                or(
                    ne(reservations.status, 'cancelled'),
                    eq(reservations.retainForProduction, true),
                ),
            ),
        );
    return rows.map((row) => row.productId);
};

const listPlannedProductIds = async (date: string): Promise<string[]> => {
    const rows = await getDb()
        .select({ productId: dailyProductPlans.productId })
        .from(dailyProductPlans)
        .where(eq(dailyProductPlans.date, date));
    return rows.map((row) => row.productId);
};

const loadProducts = async (ids: readonly string[]): Promise<ProductRow[]> =>
    ids.length === 0
        ? []
        : getDb()
              .select({
                  id: products.id,
                  name: products.name,
                  active: products.active,
                  defaultCapacity: products.defaultCapacity,
                  defaultWalkInQuantity: products.defaultWalkInQuantity,
              })
              .from(products)
              .where(inArray(products.id, [...ids]));

/**
 * The production overview for a date. Today and later: every product offered that day, plus
 * any product with committed reservations on it (e.g. deactivated since); dates without a
 * stored plan use the products' current defaults, as the catalog does. Past dates show only
 * stored plans, which every committed reservation has, so history never reflects today's
 * defaults or catalog. Nothing is locked or materialized. `now` is injectable for tests.
 * Callers must authorize the administrator.
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
    const isPast = productionDate < getPragueDate(now);

    // Pool queries, so the lookups run concurrently on separate connections.
    const [schedule, offered, extraIds] = await Promise.all([
        loadSchedule(db, productionDate),
        isPast ? [] : listOfferedProducts(db, productionDate),
        isPast ? listPlannedProductIds(productionDate) : listCommittedProductIds(productionDate),
    ]);
    const dateLock = getDateLock(productionDate, now, schedule);
    const offeredRows: ProductRow[] =
        dateLock === 'BAKERY_CLOSED'
            ? []
            : offered.map(({ id, name, defaultCapacity, defaultWalkInQuantity }) => ({
                  id,
                  name,
                  active: true,
                  defaultCapacity,
                  defaultWalkInQuantity,
              }));
    const offeredIds = new Set(offeredRows.map((row) => row.id));
    const otherRows = await loadProducts(extraIds.filter((id) => !offeredIds.has(id)));
    const productRows = [...offeredRows, ...otherRows].sort(compareByName);
    const ids = productRows.map((row) => row.id);
    if (ids.length === 0) {
        return { date: productionDate, dateLock, rows: [] };
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

    const getNotice = (row: ProductRow): ProductionRowNotice | null => {
        if (!row.active) {
            return 'INACTIVE';
        }
        // On a past or closed date the date itself explains why nothing is offered.
        return !isPast && dateLock !== 'BAKERY_CLOSED' && !offeredIds.has(row.id)
            ? 'NOT_OFFERED_ON_DATE'
            : null;
    };

    return {
        date: productionDate,
        dateLock,
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
                notice: getNotice(row),
                editable: dateLock === null && offeredIds.has(row.id),
            };
        }),
    };
};
