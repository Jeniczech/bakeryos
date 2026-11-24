import type { PickupDateRejectionReason, ProductRejectionReason } from './reservation-rules';

/** Expected business rejections; transports map `code` to a response (e.g. Problem Details). */
export abstract class DomainError extends Error {
    abstract readonly code: string;

    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export type ValidationIssue = { path: string; message: string };

export class InvalidReservationRequestError extends DomainError {
    readonly code = 'INVALID_REQUEST';

    constructor(readonly issues: readonly ValidationIssue[]) {
        super('The reservation request is invalid.');
    }
}

export class OnlineQuantityLimitError extends DomainError {
    constructor(
        readonly code: 'PRODUCT_LIMIT_EXCEEDED' | 'RESERVATION_LIMIT_EXCEEDED',
        readonly limit: number,
        readonly requested: number,
        readonly productId?: string,
    ) {
        super(
            code === 'PRODUCT_LIMIT_EXCEEDED'
                ? `Online reservations are limited to ${limit} units per product.`
                : `Online reservations are limited to ${limit} units in total.`,
        );
    }
}

const PICKUP_DATE_MESSAGES: Record<PickupDateRejectionReason, string> = {
    INVALID_DATE: 'The pickup date is not a valid date.',
    OUTSIDE_BOOKING_WINDOW: 'The pickup date is outside the booking window.',
    CUTOFF_PASSED: 'Online reservations for this date closed at 18:00 the day before.',
    BAKERY_CLOSED: 'The bakery is closed on this date.',
};

export class PickupDateUnavailableError extends DomainError {
    constructor(readonly code: PickupDateRejectionReason) {
        super(PICKUP_DATE_MESSAGES[code]);
    }
}

export type UnavailableProduct = {
    productId: string;
    reason: ProductRejectionReason | 'PRODUCT_NOT_FOUND';
};

export class ProductUnavailableError extends DomainError {
    readonly code = 'PRODUCT_UNAVAILABLE';

    constructor(readonly products: readonly UnavailableProduct[]) {
        super('Some products cannot be reserved for this date.');
    }
}

export type CapacityShortage = { productId: string; requested: number; available: number };

export class InsufficientCapacityError extends DomainError {
    readonly code = 'INSUFFICIENT_CAPACITY';

    constructor(readonly shortages: readonly CapacityShortage[]) {
        super('Some products do not have enough remaining capacity.');
    }
}

export class IdempotencyConflictError extends DomainError {
    readonly code = 'IDEMPOTENCY_CONFLICT';

    constructor() {
        super('This idempotency key was already used for a different request.');
    }
}

export class InvalidDailyPlanUpdateError extends DomainError {
    readonly code = 'INVALID_REQUEST';

    constructor(readonly issues: readonly ValidationIssue[]) {
        super('The daily plan update is invalid.');
    }
}

export class ProductNotFoundError extends DomainError {
    readonly code = 'PRODUCT_NOT_FOUND';

    constructor(readonly productId: string) {
        super('The product does not exist.');
    }
}

export class PlanBelowCommitmentsError extends DomainError {
    readonly code = 'PLAN_BELOW_COMMITMENTS';

    constructor(
        readonly productId: string,
        readonly committedQuantity: number,
    ) {
        super(
            `Capacity must cover the walk-in quantity plus ${committedQuantity} already committed units.`,
        );
    }
}
