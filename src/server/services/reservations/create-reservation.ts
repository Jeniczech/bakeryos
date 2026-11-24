import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import {
    findOnlineQuantityLimitViolation,
    ONLINE_MAX_UNITS_PER_PRODUCT,
    ONLINE_MAX_UNITS_PER_RESERVATION,
    reservationRequestSchema,
    type ReservationItemInput,
    type ReservationRequest,
} from '@/lib/validation/reservation';
import { getDb, type DbExecutor, type Transaction } from '@/server/db/client';
import { getCommittedQuantities } from '@/server/db/committed-quantities';
import { isTransientConflict, isUniqueViolation } from '@/server/db/errors';
import { lockDailyPlans, type DailyPlan } from '@/server/db/lock-daily-plans';
import { reservationItems, reservations, reservationSources } from '@/server/db/schema';
import {
    canReserve,
    getRemainingAvailability,
    type CommittedQuantities,
} from '@/server/domain/availability';
import {
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidRequestError,
    OnlineQuantityLimitError,
    toValidationIssues,
    type CapacityShortage,
} from '@/server/domain/errors';
import type { ReservationSource, ReservationStatus } from '@/server/domain/reservation-rules';
import { assertPickupDateAvailable, loadOfferedProducts } from '../eligibility';
import { deriveManagementToken, hashManagementToken } from './management-token';
import { computeRequestHash } from './request-hash';

export type CreateReservationInput = {
    idempotencyKey: string;
    pickupDate: string; // YYYY-MM-DD
    customer: { name: string; phone: string };
    items: Array<{ productId: string; quantity: number }>;
    /** Assigned by trusted server code only; public callers always get `online`. */
    source: ReservationSource;
};

export type ReservationConfirmationItem = {
    productId: string;
    productName: string;
    unitPrice: number; // haléře
    quantity: number;
};

export type CreateReservationResult = {
    reservationId: string;
    reservationNumber: string;
    pickupDate: string;
    /** `confirmed` for a new reservation; a replay reports the reservation's current status. */
    status: ReservationStatus;
    totalPrice: number; // haléře
    items: ReservationConfirmationItem[];
    managementToken: string;
    /** True when an earlier request with the same idempotency key created the reservation. */
    replayed: boolean;
};

const IDEMPOTENCY_KEY_CONSTRAINT = 'reservations_idempotency_key_unique';
const MAX_ATTEMPTS = 3;

const parseInput = (
    input: CreateReservationInput,
): { request: ReservationRequest; source: ReservationSource } => {
    if (!reservationSources.includes(input.source)) {
        throw new Error(`Invalid reservation source: ${String(input.source)}`);
    }
    const parsed = reservationRequestSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(
            toValidationIssues(parsed.error),
            'The reservation request is invalid.',
        );
    }
    return { request: parsed.data, source: input.source };
};

const assertOnlineQuantityLimits = (items: readonly ReservationItemInput[]): void => {
    const violation = findOnlineQuantityLimitViolation(items);
    if (violation?.reason === 'PRODUCT_LIMIT_EXCEEDED') {
        throw new OnlineQuantityLimitError(
            violation.reason,
            ONLINE_MAX_UNITS_PER_PRODUCT,
            violation.quantity,
            violation.productId,
        );
    }
    if (violation?.reason === 'RESERVATION_LIMIT_EXCEEDED') {
        throw new OnlineQuantityLimitError(
            violation.reason,
            ONLINE_MAX_UNITS_PER_RESERVATION,
            violation.quantity,
        );
    }
};

/** Checks the whole cart, so one rejection lists every short product. */
const assertCapacity = (
    items: readonly ReservationItemInput[],
    plans: readonly DailyPlan[],
    committed: ReadonlyMap<string, CommittedQuantities>,
): void => {
    const plansByProduct = new Map(plans.map((plan) => [plan.productId, plan]));
    const shortages: CapacityShortage[] = [];
    for (const item of items) {
        const plan = plansByProduct.get(item.productId);
        const quantities = committed.get(item.productId);
        if (!plan || !quantities) {
            throw new Error(`Missing locked plan or commitments for product ${item.productId}`);
        }
        const planQuantities = {
            capacity: plan.capacity,
            walkInQuantity: plan.walkInQuantity,
            ...quantities,
        };
        if (!canReserve(planQuantities, item.quantity)) {
            shortages.push({
                productId: item.productId,
                requested: item.quantity,
                available: Math.max(0, getRemainingAvailability(planQuantities)),
            });
        }
    }
    if (shortages.length > 0) {
        throw new InsufficientCapacityError(shortages);
    }
};

const buildResult = (
    reservation: {
        id: string;
        reservationNumber: string;
        pickupDate: string;
        status: ReservationStatus;
    },
    items: ReservationConfirmationItem[],
    managementToken: string,
    replayed: boolean,
): CreateReservationResult => ({
    reservationId: reservation.id,
    reservationNumber: reservation.reservationNumber,
    pickupDate: reservation.pickupDate,
    status: reservation.status,
    totalPrice: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    items,
    managementToken,
    replayed,
});

/**
 * Returns the original confirmation for a reused idempotency key, or null when the key is
 * new. A reused key with a different request is a conflict.
 */
const findReplay = async (
    db: DbExecutor,
    idempotencyKey: string,
    requestHash: string,
): Promise<CreateReservationResult | null> => {
    const [existing] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.idempotencyKey, idempotencyKey));
    if (!existing) {
        return null;
    }
    if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
    }
    // The token is re-derived, not stored, so a changed secret would silently hand out a dead link.
    const managementToken = deriveManagementToken(existing.id);
    if (hashManagementToken(managementToken) !== existing.managementTokenHash) {
        throw new Error(
            `Management token for reservation ${existing.id} does not match its stored hash; was MANAGEMENT_TOKEN_SECRET changed?`,
        );
    }
    const items = await db
        .select({
            productId: reservationItems.productId,
            productName: reservationItems.productNameSnapshot,
            unitPrice: reservationItems.unitPriceSnapshot,
            quantity: reservationItems.quantity,
        })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, existing.id))
        .orderBy(asc(reservationItems.productId));
    return buildResult(existing, items, managementToken, true);
};

const createInTransaction = async (
    tx: Transaction,
    request: ReservationRequest,
    source: ReservationSource,
    requestHash: string,
    now: Date,
): Promise<CreateReservationResult> => {
    const replay = await findReplay(tx, request.idempotencyKey, requestHash);
    if (replay) {
        return replay;
    }

    // Rejects ineligible dates and products before materializing or locking any plan.
    await assertPickupDateAvailable(tx, request.pickupDate, source, now);
    const productIds = request.items.map((item) => item.productId);
    await loadOfferedProducts(tx, productIds, request.pickupDate);
    const plans = await lockDailyPlans(tx, request.pickupDate, productIds);
    // A same-key request that held these locks has now committed; replay it before its
    // quantities can make this one look like a capacity shortage.
    const lockedReplay = await findReplay(tx, request.idempotencyKey, requestHash);
    if (lockedReplay) {
        return lockedReplay;
    }
    // Re-check after locking so eligibility and the price/name snapshots are current.
    await assertPickupDateAvailable(tx, request.pickupDate, source, now);
    const offered = await loadOfferedProducts(tx, productIds, request.pickupDate);
    const committed = await getCommittedQuantities(tx, request.pickupDate, productIds);
    assertCapacity(request.items, plans, committed);

    const reservationId = randomUUID();
    const managementToken = deriveManagementToken(reservationId);
    const [reservation] = await tx
        .insert(reservations)
        .values({
            id: reservationId,
            pickupDate: request.pickupDate,
            customerName: request.customer.name,
            customerPhone: request.customer.phone,
            source,
            managementTokenHash: hashManagementToken(managementToken),
            idempotencyKey: request.idempotencyKey,
            requestHash,
        })
        .returning();

    const items = request.items.map((item, index) => ({
        productId: item.productId,
        productName: offered[index].name,
        unitPrice: offered[index].price,
        quantity: item.quantity,
    }));
    await tx.insert(reservationItems).values(
        items.map((item) => ({
            reservationId,
            productId: item.productId,
            productNameSnapshot: item.productName,
            unitPriceSnapshot: item.unitPrice,
            quantity: item.quantity,
        })),
    );

    return buildResult(reservation, items, managementToken, false);
};

/**
 * Creates a confirmed reservation for every item or none, following the locking protocol
 * (TDD §6): idempotency check, eligibility, plan locks in product-ID order, then capacity
 * from committed quantities read after locking. The online cutoff and quantity limits apply
 * only to `online`; capacity applies to every source. `now` is injectable for tests.
 */
export const createReservation = async (
    input: CreateReservationInput,
    options: { now?: Date } = {},
): Promise<CreateReservationResult> => {
    const { request, source } = parseInput(input);
    if (source === 'online') {
        assertOnlineQuantityLimits(request.items);
    }
    const now = options.now ?? new Date();
    const requestHash = computeRequestHash(request, source);

    for (let attempt = 1; ; attempt++) {
        try {
            return await getDb().transaction((tx) =>
                createInTransaction(tx, request, source, requestHash, now),
            );
        } catch (error) {
            // A concurrent request with the same key committed first; the unique constraint is
            // the final duplicate guard. Its committed row decides between replay and conflict.
            if (isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
                const replay = await findReplay(getDb(), request.idempotencyKey, requestHash);
                if (replay) {
                    return replay;
                }
            }
            if (attempt < MAX_ATTEMPTS && isTransientConflict(error)) {
                continue;
            }
            throw error;
        }
    }
};
