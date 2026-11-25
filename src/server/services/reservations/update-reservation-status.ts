import { eq } from 'drizzle-orm';
import { uuidSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { reservations } from '@/server/db/schema';
import { ReservationNotFoundError, StatusTransitionError } from '@/server/domain/errors';
import { checkStatusTransition } from '@/server/domain/reservation-rules';

/** Pickup outcomes; cancellation goes through `cancelReservation`, which releases capacity. */
export type PickupOutcome = 'picked_up' | 'no_show';

export type UpdateReservationStatusInput = { reservationId: string; status: PickupOutcome };

/**
 * Records a pickup outcome for a confirmed reservation; admins are authorized by the caller.
 * Both outcomes keep the items committed, so capacity is unaffected and only the reservation
 * row is locked: competing changes queue on it and re-check the status. Setting the status the
 * reservation already has is a no-op, so a repeated submission succeeds. `now` is injectable
 * for tests and otherwise read after locking.
 */
export const updateReservationStatus = async (
    input: UpdateReservationStatusInput,
    options: { now?: Date } = {},
): Promise<void> => {
    const parsed = uuidSchema.safeParse(input.reservationId);
    if (!parsed.success) {
        throw new ReservationNotFoundError();
    }
    const reservationId = parsed.data;
    await getDb().transaction(async (tx) => {
        const [current] = await tx
            .select({ status: reservations.status, pickupDate: reservations.pickupDate })
            .from(reservations)
            .where(eq(reservations.id, reservationId))
            .for('update');
        if (!current) {
            throw new ReservationNotFoundError();
        }
        if (current.status === input.status) {
            return;
        }
        const transition = checkStatusTransition({
            from: current.status,
            to: input.status,
            actor: 'admin',
            pickupDate: current.pickupDate,
            now: options.now ?? new Date(),
        });
        if (!transition.ok) {
            throw new StatusTransitionError(transition.reason);
        }
        await tx
            .update(reservations)
            .set({ status: input.status })
            .where(eq(reservations.id, reservationId));
    });
};
