import { eq } from 'drizzle-orm';
import { getPragueDate } from '@/lib/date-time/prague';
import { dailyPlanUpdateSchema, type DailyPlanUpdate } from '@/lib/validation/daily-plan';
import { getDb, type Transaction } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { lockDailyPlans, MissingDailyPlanError } from '@/server/db/lock-daily-plans';
import { dailyProductPlans, products } from '@/server/db/schema';
import { canUpdatePlan, getCommittedQuantity } from '@/server/domain/availability';
import {
    InvalidDailyPlanUpdateError,
    PlanBelowCommitmentsError,
    ProductNotFoundError,
} from '@/server/domain/errors';
import { buildDailyProductionItem, type DailyProductionItem } from '@/server/domain/production';

export type UpdateDailyPlanInput = {
    productId: string;
    date: string; // YYYY-MM-DD
    capacity: number;
    walkInQuantity: number;
};

const parseInput = (input: UpdateDailyPlanInput, now: Date): DailyPlanUpdate => {
    const parsed = dailyPlanUpdateSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidDailyPlanUpdateError(
            parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        );
    }
    // Past plans are production history; editing them would rewrite what was planned.
    if (parsed.data.date < getPragueDate(now)) {
        throw new InvalidDailyPlanUpdateError([
            { path: 'date', message: 'Plans for past dates cannot be changed.' },
        ]);
    }
    return parsed.data;
};

const updateInTransaction = async (
    tx: Transaction,
    update: DailyPlanUpdate,
): Promise<DailyProductionItem> => {
    const [plan] = await lockDailyPlans(tx, update.date, [update.productId]);
    const [product] = await tx
        .select({ name: products.name })
        .from(products)
        .where(eq(products.id, update.productId));
    const committed = (await getCommittedQuantities(tx, update.date, [update.productId])).get(
        update.productId,
    );
    if (!committed) {
        throw new Error(`Missing commitments for product ${update.productId}`);
    }
    if (!canUpdatePlan(committed, update)) {
        throw new PlanBelowCommitmentsError(update.productId, getCommittedQuantity(committed));
    }

    await tx
        .update(dailyProductPlans)
        .set({ capacity: update.capacity, walkInQuantity: update.walkInQuantity })
        .where(eq(dailyProductPlans.id, plan.id));

    return buildDailyProductionItem(
        { productId: update.productId, productName: product.name },
        { capacity: update.capacity, walkInQuantity: update.walkInQuantity, ...committed },
    );
};

/**
 * Overrides one product/date's capacity and walk-in quantity under the shared locking
 * protocol (TDD §6.6): materialize and lock the plan, read committed quantities after the
 * lock, and reject any plan that would no longer cover walk-ins plus commitments. Allowed
 * after the online cutoff and for today, never for past dates. Callers must authorize the
 * administrator; `now` is injectable for tests.
 */
export const updateDailyPlan = async (
    input: UpdateDailyPlanInput,
    options: { now?: Date } = {},
): Promise<DailyProductionItem> => {
    const update = parseInput(input, options.now ?? new Date());
    try {
        return await getDb().transaction((tx) => updateInTransaction(tx, update));
    } catch (error) {
        if (error instanceof MissingDailyPlanError) {
            throw new ProductNotFoundError(update.productId);
        }
        throw error;
    }
};
