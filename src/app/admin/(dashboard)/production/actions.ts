'use server';

import { refresh } from 'next/cache';
import { requireAdmin } from '@/server/auth/require-admin';
import {
    InvalidRequestError,
    PickupDateUnavailableError,
    PlanBelowCommitmentsError,
    ProductNotFoundError,
    ProductUnavailableError,
} from '@/server/domain/errors';
import { updateDailyPlan } from '@/server/services/production/update-daily-plan';

export type DailyPlanField = 'capacity' | 'walkInQuantity';

export type DailyPlanFormValues = Record<DailyPlanField, string>;

export type DailyPlanFormState = {
    error:
        | 'INVALID_REQUEST'
        | 'BELOW_COMMITMENTS'
        | 'DATE_UNAVAILABLE'
        | 'PRODUCT_UNAVAILABLE'
        | 'UNAVAILABLE'
        | null;
    fields: DailyPlanField[];
    /** Set with `BELOW_COMMITMENTS`: the reserved units the capacity must still cover. */
    committedQuantity: number | null;
    /** What was entered, so a rejected form keeps it; `null` after a successful save. */
    values: DailyPlanFormValues | null;
    saved: boolean;
};

const PLAN_FIELDS: readonly DailyPlanField[] = ['capacity', 'walkInQuantity'];

const text = (formData: FormData, name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
};

/** A whole number typed in the form, or `NaN`, which the service rejects for that field. */
const parseWholeNumber = (value: string): number =>
    /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;

const failure = (
    error: Exclude<DailyPlanFormState['error'], null>,
    values: DailyPlanFormValues,
    details: Partial<Pick<DailyPlanFormState, 'fields' | 'committedQuantity'>> = {},
): DailyPlanFormState => ({
    error,
    fields: details.fields ?? [],
    committedQuantity: details.committedQuantity ?? null,
    values,
    saved: false,
});

const toFailure = (error: unknown, values: DailyPlanFormValues): DailyPlanFormState => {
    if (error instanceof PlanBelowCommitmentsError) {
        return failure('BELOW_COMMITMENTS', values, {
            fields: ['capacity'],
            committedQuantity: error.committedQuantity,
        });
    }
    if (error instanceof InvalidRequestError) {
        const fields = PLAN_FIELDS.filter((field) =>
            error.issues.some((issue) => issue.path === field),
        );
        if (fields.length > 0) {
            return failure('INVALID_REQUEST', values, { fields });
        }
        // Otherwise the hidden fields were rejected: a malformed product ID, or a past date.
        return error.issues.some((issue) => issue.path === 'productId')
            ? failure('PRODUCT_UNAVAILABLE', values)
            : failure('DATE_UNAVAILABLE', values);
    }
    if (error instanceof PickupDateUnavailableError) {
        return failure('DATE_UNAVAILABLE', values);
    }
    if (error instanceof ProductNotFoundError || error instanceof ProductUnavailableError) {
        return failure('PRODUCT_UNAVAILABLE', values);
    }
    console.error('[admin] daily plan update failed', error);
    return failure('UNAVAILABLE', values);
};

/**
 * Overrides one product's capacity and walk-in quantity for a date through the shared
 * `updateDailyPlan` service, which locks the plan and rejects anything below existing
 * commitments. Every outcome refreshes the page, so the table shows the current figures.
 */
export const updateDailyPlanAction = async (
    _previous: DailyPlanFormState,
    formData: FormData,
): Promise<DailyPlanFormState> => {
    await requireAdmin();
    const values: DailyPlanFormValues = {
        capacity: text(formData, 'capacity'),
        walkInQuantity: text(formData, 'walkInQuantity'),
    };
    let state: DailyPlanFormState;
    try {
        await updateDailyPlan({
            productId: text(formData, 'productId'),
            date: text(formData, 'date'),
            capacity: parseWholeNumber(values.capacity),
            walkInQuantity: parseWholeNumber(values.walkInQuantity),
        });
        state = { error: null, fields: [], committedQuantity: null, values: null, saved: true };
    } catch (error) {
        state = toFailure(error, values);
    }
    refresh();
    return state;
};
