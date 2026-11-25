import type { ReservationConfirmation } from '@/lib/cart/checkout';
import type { CreateReservationResult } from '@/server/services/reservations/create-reservation';
import type { ReservationDetails } from '@/server/services/reservations/get-reservation';

/** The customer page for a management token; the token is a bearer credential. */
export const buildManagementUrl = (origin: string, managementToken: string): string =>
    new URL(`/reservations/manage/${managementToken}`, origin).toString();

export const toConfirmationBody = (
    result: CreateReservationResult,
    origin: string,
): ReservationConfirmation => ({
    reservationNumber: result.reservationNumber,
    pickupDate: result.pickupDate,
    status: result.status,
    totalPrice: result.totalPrice,
    items: result.items,
    managementUrl: buildManagementUrl(origin, result.managementToken),
});

export const toReservationDetailsBody = (details: ReservationDetails) => ({
    reservationNumber: details.reservationNumber,
    pickupDate: details.pickupDate,
    status: details.status,
    customerName: details.customerName,
    totalPrice: details.totalPrice,
    items: details.items,
    cancellationCutoff: details.cancellationCutoff.toISOString(),
    canCancel: details.canCancel,
});
