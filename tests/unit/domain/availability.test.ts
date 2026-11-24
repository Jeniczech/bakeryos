import { describe, expect, it } from 'vitest';
import {
    canReserve,
    canUpdatePlan,
    getCommittedQuantity,
    getRemainingAvailability,
    isCommitted,
    summarizeCommitments,
} from '@/server/domain/availability';
import { buildDailyProductionItem, getRecommendedProduction } from '@/server/domain/production';

describe('isCommitted', () => {
    it.each([
        ['confirmed', false, true],
        ['picked_up', false, true],
        ['no_show', false, true],
        ['cancelled', false, false],
        ['cancelled', true, true],
    ] as const)('%s with retain=%s → %s', (status, retainForProduction, expected) => {
        expect(isCommitted({ status, retainForProduction })).toBe(expected);
    });
});

describe('summarizeCommitments', () => {
    it('separates active and retained-cancelled quantities and ignores released ones', () => {
        expect(
            summarizeCommitments([
                { status: 'confirmed', retainForProduction: false, quantity: 3 },
                { status: 'picked_up', retainForProduction: false, quantity: 2 },
                { status: 'no_show', retainForProduction: false, quantity: 1 },
                { status: 'cancelled', retainForProduction: true, quantity: 4 },
                { status: 'cancelled', retainForProduction: false, quantity: 10 },
            ]),
        ).toEqual({ activeReserved: 6, retainedCancelled: 4 });
    });

    it('returns zeros for no items', () => {
        expect(summarizeCommitments([])).toEqual({ activeReserved: 0, retainedCancelled: 0 });
    });
});

describe('availability and production', () => {
    const plan = { capacity: 20, walkInQuantity: 5, activeReserved: 6, retainedCancelled: 4 };

    it('computes committed, remaining, and recommended quantities', () => {
        expect(getCommittedQuantity(plan)).toBe(10);
        expect(getRemainingAvailability(plan)).toBe(5);
        expect(getRecommendedProduction(plan)).toBe(15);
    });

    it('allows reserving exactly the remaining quantity but not more', () => {
        expect(canReserve(plan, 5)).toBe(true);
        expect(canReserve(plan, 6)).toBe(false);
    });

    it('builds a daily production item', () => {
        expect(buildDailyProductionItem({ productId: 'p1', productName: 'Rye' }, plan)).toEqual({
            productId: 'p1',
            productName: 'Rye',
            capacity: 20,
            activeReserved: 6,
            retainedCancelled: 4,
            walkInQuantity: 5,
            recommendedProduction: 15,
            remainingAvailability: 5,
        });
    });
});

describe('canUpdatePlan', () => {
    const committed = { activeReserved: 6, retainedCancelled: 4 };

    it('allows capacity exactly equal to walk-in plus commitments', () => {
        expect(canUpdatePlan(committed, { capacity: 15, walkInQuantity: 5 })).toBe(true);
    });

    it('rejects capacity below walk-in plus commitments', () => {
        expect(canUpdatePlan(committed, { capacity: 14, walkInQuantity: 5 })).toBe(false);
        expect(canUpdatePlan(committed, { capacity: 15, walkInQuantity: 6 })).toBe(false);
    });

    it('counts retained late cancellations as commitments', () => {
        expect(
            canUpdatePlan(
                { activeReserved: 0, retainedCancelled: 4 },
                { capacity: 3, walkInQuantity: 0 },
            ),
        ).toBe(false);
    });

    it('rejects negative values', () => {
        const none = { activeReserved: 0, retainedCancelled: 0 };
        expect(canUpdatePlan(none, { capacity: -1, walkInQuantity: -1 })).toBe(false);
        expect(canUpdatePlan(none, { capacity: 5, walkInQuantity: -1 })).toBe(false);
    });
});
