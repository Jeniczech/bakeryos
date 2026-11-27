import { eq } from 'drizzle-orm';
import { uuidSchema } from '@/lib/validation/reservation';
import { getDb, type Transaction } from '@/server/db/client';
import { isTransientConflict } from '@/server/db/errors';
import { lockDailyPlans } from '@/server/db/lock-daily-plans';
import { reservationItems, reservations } from '@/server/db/schema';
import { ReservationNotFoundError, StatusTransitionError } from '@/server/domain/errors';
import { checkStatusTransition } from '@/server/domain/reservation-rules';
import {
    findReservationIdByToken,
    loadReservationDetails,
    type ReservationDetails,
} from './get-reservation';

/** Customers prove access with the management token; admins are authorized by the caller. */
export type CancelReservationInput =
    { actor: 'customer'; token: string } | { actor: 'admin'; reservationId: string };

const MAX_ATTEMPTS = 3;

const resolveReservationId = async (input: CancelReservationInput): Promise<string | null> => {
    if (input.actor === 'customer') {
        return findReservationIdByToken(getDb(), input.token);
    }
    const parsed = uuidSchema.safeParse(input.reservationId);
    return parsed.success ? parsed.data : null;
};

const cancelInTransaction = async (
    tx: Transaction,
    input: CancelReservationInput,
    reservationId: string,
    pickupDate: string,
    productIds: string[],
    getNow: () => Date,
): Promise<ReservationDetails> => {
    await lockDailyPlans(tx, pickupDate, productIds);
    // Locked after the plans, the same order as every other capacity-affecting write.
    const [current] = await tx
        .select({ status: reservations.status })
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .for('update');
    if (!current) {
        throw new ReservationNotFoundError();
    }
    // Read after the locks: the wait may cross the cutoff, which must then count as late.
    const now = getNow();
    if (current.status !== 'cancelled') {
        const transition = checkStatusTransition({
            from: current.status,
            to: 'cancelled',
            actor: input.actor,
            pickupDate,
            now,
        });
        if (!transition.ok) {
            throw new StatusTransitionError(transition.reason);
        }
        await tx
            .update(reservations)
            .set({
                status: 'cancelled',
                cancelledAt: now,
                retainForProduction: transition.retainForProduction,
            })
            .where(eq(reservations.id, reservationId));
    }
    return loadReservationDetails(tx, reservationId, now);
};

/**
 * Cancels a confirmed reservation under the shared locking protocol (TDD §6.4). Customers and
 * admins may cancel until the pickup date ends; a cancellation at or after the cutoff keeps
 * the items committed (`retain_for_production`). Cancelling an already-cancelled reservation
 * returns its current state without writing. Deadlocks and serialization failures are
 * retried. `now` is injectable for tests and otherwise read after locking.
 */
export const cancelReservation = async (
    input: CancelReservationInput,
    options: { now?: Date } = {},
): Promise<ReservationDetails> => {
    const getNow = () => options.now ?? new Date();
    const reservationId = await resolveReservationId(input);
    if (!reservationId) {
        throw new ReservationNotFoundError();
    }
    // Pickup date and items never change, so they can be read before locking.
    const [reservation] = await getDb()
        .select({ pickupDate: reservations.pickupDate })
        .from(reservations)
        .where(eq(reservations.id, reservationId));
    if (!reservation) {
        throw new ReservationNotFoundError();
    }
    const items = await getDb()
        .select({ productId: reservationItems.productId })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, reservationId));
    const productIds = items.map((item) => item.productId);

    for (let attempt = 1; ; attempt++) {
        try {
            return await getDb().transaction((tx) =>
                cancelInTransaction(
                    tx,
                    input,
                    reservationId,
                    reservation.pickupDate,
                    productIds,
                    getNow,
                ),
            );
        } catch (error) {
            if (attempt < MAX_ATTEMPTS && isTransientConflict(error)) {
                continue;
            }
            throw error;
        }
    }
};
