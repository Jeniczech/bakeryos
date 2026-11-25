import { z } from 'zod';
import { calendarDateSchema, uuidSchema } from './reservation';

/** PostgreSQL `integer` upper bound; larger values would fail in the database instead of here. */
const MAX_PLAN_QUANTITY = 2_147_483_647;

const planQuantitySchema = z.int().min(0).max(MAX_PLAN_QUANTITY);

export const dailyPlanUpdateSchema = z
    .object({
        productId: uuidSchema,
        date: calendarDateSchema,
        capacity: planQuantitySchema,
        walkInQuantity: planQuantitySchema,
        /** The plan the editor loaded; the update is rejected if the stored plan differs. */
        expected: z
            .object({ capacity: planQuantitySchema, walkInQuantity: planQuantitySchema })
            .optional(),
    })
    .refine((plan) => plan.walkInQuantity <= plan.capacity, {
        path: ['walkInQuantity'],
        message: 'Walk-in quantity cannot exceed capacity.',
    });

export type DailyPlanUpdate = z.output<typeof dailyPlanUpdateSchema>;
