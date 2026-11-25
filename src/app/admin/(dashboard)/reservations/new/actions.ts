'use server';

import { refresh } from 'next/cache';
import { requireAdmin } from '@/server/auth/require-admin';
import {
    IdempotencyConflictError,
    InsufficientCapacityError,
    InvalidRequestError,
    PickupDateUnavailableError,
    ProductUnavailableError,
    type CapacityShortage,
} from '@/server/domain/errors';
import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';
import { createReservation } from '@/server/services/reservations/create-reservation';

export type ManualReservationInput = {
    idempotencyKey: string;
    pickupDate: string;
    customer: { name: string; phone: string };
    items: Array<{ productId: string; quantity: number }>;
};

export type ManualReservationField = 'customer.name' | 'customer.phone' | 'items' | 'other';

export type ManualReservationResult =
    | {
          ok: true;
          reservationNumber: string;
          pickupDate: string;
          totalPrice: number; // haléře
      }
    | { ok: false; error: 'INVALID_REQUEST'; fields: ManualReservationField[] }
    | { ok: false; error: PickupDateRejectionReason }
    | { ok: false; error: 'PRODUCT_UNAVAILABLE'; productIds: string[] }
    | { ok: false; error: 'INSUFFICIENT_CAPACITY'; shortages: CapacityShortage[] }
    | { ok: false; error: 'IDEMPOTENCY_CONFLICT' | 'UNAVAILABLE' };

const FORM_FIELDS: readonly ManualReservationField[] = ['customer.name', 'customer.phone', 'items'];

const toFormField = (path: string): ManualReservationField =>
    FORM_FIELDS.find((field) => path === field || path.startsWith(`${field}.`)) ?? 'other';

const toFailure = (error: unknown): ManualReservationResult => {
    if (error instanceof InvalidRequestError) {
        const fields = new Set(error.issues.map((issue) => toFormField(issue.path)));
        return { ok: false, error: 'INVALID_REQUEST', fields: [...fields] };
    }
    if (error instanceof PickupDateUnavailableError) {
        return { ok: false, error: error.code };
    }
    if (error instanceof ProductUnavailableError) {
        return {
            ok: false,
            error: 'PRODUCT_UNAVAILABLE',
            productIds: error.products.map((product) => product.productId),
        };
    }
    if (error instanceof InsufficientCapacityError) {
        return { ok: false, error: 'INSUFFICIENT_CAPACITY', shortages: [...error.shortages] };
    }
    if (error instanceof IdempotencyConflictError) {
        return { ok: false, error: 'IDEMPOTENCY_CONFLICT' };
    }
    console.error('[admin] manual reservation failed', error);
    return { ok: false, error: 'UNAVAILABLE' };
};

/**
 * Records a phone reservation through the shared `createReservation` service. The `admin`
 * source is set here and overrides anything the client sends. Phone reservations follow the
 * online booking window, cutoff, opening days and capacity; only the online quantity limits
 * do not apply. A retry with the same idempotency key returns the original reservation. Every
 * outcome refreshes the page, so the remaining quantities stay current.
 */
export const createManualReservation = async (
    input: ManualReservationInput,
): Promise<ManualReservationResult> => {
    await requireAdmin();
    let result: ManualReservationResult;
    try {
        // The service validates the untrusted fields; spreading a non-object yields `{}`.
        const reservation = await createReservation({ ...input, source: 'admin' });
        result = {
            ok: true,
            reservationNumber: reservation.reservationNumber,
            pickupDate: reservation.pickupDate,
            totalPrice: reservation.totalPrice,
        };
    } catch (error) {
        result = toFailure(error);
    }
    refresh();
    return result;
};
