'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/require-admin';
import { ReservationNotFoundError, StatusTransitionError } from '@/server/domain/errors';
import {
    ADMIN_STATUS_TARGETS,
    type StatusTransitionRejectionReason,
} from '@/server/domain/reservation-rules';
import { cancelReservation } from '@/server/services/reservations/cancel-reservation';
import { updateReservationStatus } from '@/server/services/reservations/update-reservation-status';

export type StatusChangeError =
    StatusTransitionRejectionReason | 'NOT_FOUND' | 'INVALID_REQUEST' | 'UNAVAILABLE';

export type StatusChangeState = { error: StatusChangeError | null };

const statusChangeSchema = z.object({
    reservationId: z.string(),
    status: z.enum(ADMIN_STATUS_TARGETS),
});

const applyStatusChange = async (
    reservationId: string,
    status: (typeof ADMIN_STATUS_TARGETS)[number],
): Promise<StatusChangeError | null> => {
    try {
        if (status === 'cancelled') {
            await cancelReservation({ actor: 'admin', reservationId });
        } else {
            await updateReservationStatus({ reservationId, status });
        }
        return null;
    } catch (error) {
        if (error instanceof StatusTransitionError) {
            return error.code;
        }
        if (error instanceof ReservationNotFoundError) {
            return 'NOT_FOUND';
        }
        console.error('[admin] reservation status change failed', error);
        return 'UNAVAILABLE';
    }
};

/**
 * Marks a reservation picked up or no-show, or cancels it. Cancellation goes through the
 * shared `cancelReservation` service, so an early one releases capacity and a late one keeps
 * the items in production. Every outcome refreshes the page: a rejection usually means the
 * status changed in the meantime.
 */
export const changeReservationStatus = async (
    _previous: StatusChangeState,
    formData: FormData,
): Promise<StatusChangeState> => {
    await requireAdmin();
    const parsed = statusChangeSchema.safeParse({
        reservationId: formData.get('reservationId'),
        status: formData.get('status'),
    });
    if (!parsed.success) {
        return { error: 'INVALID_REQUEST' };
    }
    const error = await applyStatusChange(parsed.data.reservationId, parsed.data.status);
    refresh();
    return { error };
};
