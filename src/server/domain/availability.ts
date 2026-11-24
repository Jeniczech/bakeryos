import type { ReservationStatus } from './reservation-rules';

export type CommittedItem = {
    status: ReservationStatus;
    retainForProduction: boolean;
    quantity: number;
};

export type CommittedQuantities = {
    activeReserved: number;
    retainedCancelled: number;
};

export type PlanQuantities = CommittedQuantities & {
    capacity: number;
    walkInQuantity: number;
};

/** Every non-cancelled item is committed; a cancelled item only when retained for production. */
export const isCommitted = (item: Pick<CommittedItem, 'status' | 'retainForProduction'>) =>
    item.status !== 'cancelled' || item.retainForProduction;

export const summarizeCommitments = (items: readonly CommittedItem[]): CommittedQuantities => {
    let activeReserved = 0;
    let retainedCancelled = 0;
    for (const item of items) {
        if (item.status !== 'cancelled') {
            activeReserved += item.quantity;
        } else if (item.retainForProduction) {
            retainedCancelled += item.quantity;
        }
    }
    return { activeReserved, retainedCancelled };
};

export const getCommittedQuantity = (quantities: CommittedQuantities): number =>
    quantities.activeReserved + quantities.retainedCancelled;

/** May be negative only for corrupted data; valid writes keep it at zero or above. */
export const getRemainingAvailability = (plan: PlanQuantities): number =>
    plan.capacity - plan.walkInQuantity - getCommittedQuantity(plan);

export const canReserve = (plan: PlanQuantities, requestedQuantity: number): boolean =>
    requestedQuantity <= getRemainingAvailability(plan);

/** A plan edit must keep capacity >= walk-in + committed quantity. */
export const canUpdatePlan = (
    committed: CommittedQuantities,
    update: { capacity: number; walkInQuantity: number },
): boolean =>
    update.capacity >= 0 &&
    update.walkInQuantity >= 0 &&
    update.capacity >= update.walkInQuantity + getCommittedQuantity(committed);
