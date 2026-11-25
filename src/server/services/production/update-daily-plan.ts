import { eq } from 'drizzle-orm';
import { getPragueDate } from '@/lib/date-time/prague';
import { dailyPlanUpdateSchema, type DailyPlanUpdate } from '@/lib/validation/daily-plan';
import { getDb, type Transaction } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { lockDailyPlans, MissingDailyPlanError } from '@/server/db/lock-daily-plans';
import { dailyProductPlans } from '@/server/db/schema';
import { canUpdatePlan, getCommittedQuantity } from '@/server/domain/availability';
import {
    InvalidRequestError,
    PlanBelowCommitmentsError,
    PlanChangedError,
    ProductNotFoundError,
    ProductUnavailableError,
    toValidationIssues,
} from '@/server/domain/errors';
import { buildDailyProductionItem, type DailyProductionItem } from '@/server/domain/production';
import { assertPlanDateAvailable, loadOfferedProducts, type OfferedProduct } from '../eligibility';

export type UpdateDailyPlanInput = {
    productId: string;
    date: string; // YYYY-MM-DD
    capacity: number;
    walkInQuantity: number;
    /**
     * The capacity and walk-in quantity the editor showed (the product defaults when no plan
     * existed yet). When given, the update is rejected if the stored plan differs, so an
     * outdated form never undoes a newer save.
     */
    expected?: { capacity: number; walkInQuantity: number };
};

const parseInput = (input: UpdateDailyPlanInput): DailyPlanUpdate => {
    const parsed = dailyPlanUpdateSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(
            toValidationIssues(parsed.error),
            'The daily plan update is invalid.',
        );
    }
    return parsed.data;
};

/**
 * Past plans are production history; editing them would rewrite what was planned. Beyond
 * that, the date must be in the planning window and open, and the product offered.
 */
const assertPlanEditable = async (
    tx: Transaction,
    update: DailyPlanUpdate,
    now: Date,
): Promise<OfferedProduct> => {
    if (update.date < getPragueDate(now)) {
        throw new InvalidRequestError(
            [{ path: 'date', message: 'Plans for past dates cannot be changed.' }],
            'The daily plan update is invalid.',
        );
    }
    await assertPlanDateAvailable(tx, update.date, now);
    try {
        const [product] = await loadOfferedProducts(tx, [update.productId], update.date);
        return product;
    } catch (error) {
        if (
            error instanceof ProductUnavailableError &&
            error.products.some((product) => product.reason === 'PRODUCT_NOT_FOUND')
        ) {
            throw new ProductNotFoundError(update.productId);
        }
        throw error;
    }
};

const updateInTransaction = async (
    tx: Transaction,
    update: DailyPlanUpdate,
    getNow: () => Date,
): Promise<DailyProductionItem> => {
    // Rejects ineligible products/dates before materializing a plan, then again after the
    // lock, which may have been waited on past midnight or a concurrent closure/deactivation.
    await assertPlanEditable(tx, update, getNow());
    const [plan] = await lockDailyPlans(tx, update.date, [update.productId]);
    const product = await assertPlanEditable(tx, update, getNow());
    if (
        update.expected &&
        (plan.capacity !== update.expected.capacity ||
            plan.walkInQuantity !== update.expected.walkInQuantity)
    ) {
        throw new PlanChangedError(update.productId, {
            capacity: plan.capacity,
            walkInQuantity: plan.walkInQuantity,
        });
    }
    // Keyed by the lowercase ID; the schema lowercases `productId`, so the entry always exists.
    const committed = (await getCommittedQuantities(tx, update.date, [update.productId])).get(
        update.productId,
    )!;
    if (!canUpdatePlan(committed, update)) {
        throw new PlanBelowCommitmentsError(update.productId, getCommittedQuantity(committed));
    }

    await tx
        .update(dailyProductPlans)
        .set({ capacity: update.capacity, walkInQuantity: update.walkInQuantity })
        .where(eq(dailyProductPlans.id, plan.id));

    return buildDailyProductionItem(
        { productId: product.id, productName: product.name },
        { capacity: update.capacity, walkInQuantity: update.walkInQuantity, ...committed },
    );
};

/**
 * Overrides one product/date's capacity and walk-in quantity under the shared locking
 * protocol (TDD §6.6): check eligibility, materialize and lock the plan, re-check
 * eligibility and read committed quantities after the lock, and reject any plan that would
 * no longer cover walk-ins plus commitments. Allowed after the reservation cutoff and for
 * today, never for past dates or outside the planning window (today through today+7). Callers must authorize the
 * administrator; `now` is injectable for tests and otherwise read at each check.
 */
export const updateDailyPlan = async (
    input: UpdateDailyPlanInput,
    options: { now?: Date } = {},
): Promise<DailyProductionItem> => {
    const update = parseInput(input);
    const getNow = () => options.now ?? new Date();
    try {
        return await getDb().transaction((tx) => updateInTransaction(tx, update, getNow));
    } catch (error) {
        if (error instanceof MissingDailyPlanError) {
            throw new ProductNotFoundError(update.productId);
        }
        throw error;
    }
};
