import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
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
import {
    bakeryClosures,
    bakeryOpeningDays,
    productWeekdays,
    products,
    reservationItems,
    reservations,
    reservationSources,
} from '@/server/db/schema';
import { getRemainingAvailability, type CommittedQuantities } from '@/server/domain/availability';
import {
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidReservationRequestError,
    OnlineQuantityLimitError,
    PickupDateUnavailableError,
    ProductUnavailableError,
    type CapacityShortage,
    type UnavailableProduct,
} from '@/server/domain/errors';
import {
    checkPickupDate,
    checkProductOffered,
    type BakerySchedule,
    type ReservationSource,
    type ReservationStatus,
} from '@/server/domain/reservation-rules';
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

type OfferedProduct = { id: string; name: string; price: number };

const parseInput = (
    input: CreateReservationInput,
): { request: ReservationRequest; source: ReservationSource } => {
    if (!reservationSources.includes(input.source)) {
        throw new Error(`Invalid reservation source: ${String(input.source)}`);
    }
    const parsed = reservationRequestSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidReservationRequestError(
            parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
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

const loadSchedule = async (tx: Transaction, pickupDate: string): Promise<BakerySchedule> => {
    const openDays = await tx
        .select({ weekday: bakeryOpeningDays.weekday })
        .from(bakeryOpeningDays)
        .where(eq(bakeryOpeningDays.isOpen, true));
    const closures = await tx
        .select({ date: bakeryClosures.date })
        .from(bakeryClosures)
        .where(eq(bakeryClosures.date, pickupDate));
    return {
        openWeekdays: new Set(openDays.map((day) => day.weekday)),
        closures: new Set(closures.map((closure) => closure.date)),
    };
};

/** Returns the products in the order of `productIds`, or rejects every unavailable one at once. */
const loadOfferedProducts = async (
    tx: Transaction,
    productIds: readonly string[],
    pickupDate: string,
): Promise<OfferedProduct[]> => {
    const rows = await tx
        .select({
            id: products.id,
            name: products.name,
            price: products.price,
            active: products.active,
        })
        .from(products)
        .where(inArray(products.id, [...productIds]));
    const weekdayRows = await tx
        .select({ productId: productWeekdays.productId, weekday: productWeekdays.weekday })
        .from(productWeekdays)
        .where(inArray(productWeekdays.productId, [...productIds]));

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const offered: OfferedProduct[] = [];
    const unavailable: UnavailableProduct[] = [];
    for (const productId of productIds) {
        const row = rowsById.get(productId);
        if (!row) {
            unavailable.push({ productId, reason: 'PRODUCT_NOT_FOUND' });
            continue;
        }
        const weekdays = weekdayRows
            .filter((weekdayRow) => weekdayRow.productId === productId)
            .map((weekdayRow) => weekdayRow.weekday);
        const check = checkProductOffered({ active: row.active, weekdays }, pickupDate);
        if (check.ok) {
            offered.push({ id: row.id, name: row.name, price: row.price });
        } else {
            unavailable.push({ productId, reason: check.reason });
        }
    }
    if (unavailable.length > 0) {
        throw new ProductUnavailableError(unavailable);
    }
    return offered;
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
        const available = getRemainingAvailability({
            capacity: plan.capacity,
            walkInQuantity: plan.walkInQuantity,
            ...quantities,
        });
        if (item.quantity > available) {
            shortages.push({
                productId: item.productId,
                requested: item.quantity,
                available: Math.max(0, available),
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
    replayed: boolean,
): CreateReservationResult => ({
    reservationId: reservation.id,
    reservationNumber: reservation.reservationNumber,
    pickupDate: reservation.pickupDate,
    status: reservation.status,
    totalPrice: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    items,
    managementToken: deriveManagementToken(reservation.id),
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
    return buildResult(existing, items, true);
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

    const schedule = await loadSchedule(tx, request.pickupDate);
    const dateCheck = checkPickupDate({ pickupDate: request.pickupDate, source, now, schedule });
    if (!dateCheck.ok) {
        throw new PickupDateUnavailableError(dateCheck.reason);
    }

    const productIds = request.items.map((item) => item.productId);
    // Rejects unknown or unavailable products before materializing or locking any plan.
    await loadOfferedProducts(tx, productIds, request.pickupDate);
    const plans = await lockDailyPlans(tx, request.pickupDate, productIds);
    // Re-read after locking so eligibility and the price/name snapshots are current.
    const offered = await loadOfferedProducts(tx, productIds, request.pickupDate);
    const committed = await getCommittedQuantities(tx, request.pickupDate, productIds);
    assertCapacity(request.items, plans, committed);

    const reservationId = randomUUID();
    const [reservation] = await tx
        .insert(reservations)
        .values({
            id: reservationId,
            pickupDate: request.pickupDate,
            customerName: request.customer.name,
            customerPhone: request.customer.phone,
            source,
            managementTokenHash: hashManagementToken(deriveManagementToken(reservationId)),
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

    return buildResult(reservation, items, false);
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
