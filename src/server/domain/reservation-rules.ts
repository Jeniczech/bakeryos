import {
    addDays,
    getPragueDate,
    getWeekday,
    isValidCalendarDate,
    pragueTimeToInstant,
    type CalendarDate,
} from '@/lib/date-time/prague';

export type ReservationSource = 'online' | 'admin';
export type ReservationStatus = 'confirmed' | 'picked_up' | 'cancelled' | 'no_show';
export type ReservationActor = 'customer' | 'admin';

export const ONLINE_CUTOFF_HOUR = 18;
export const BOOKING_WINDOW_DAYS = 7;

type Rejection<Reason extends string> = { ok: false; reason: Reason };

/** 18:00 Prague time on the calendar day before pickup; not a fixed 24 hours before. */
export const getOnlineCutoff = (pickupDate: CalendarDate): Date =>
    pragueTimeToInstant(addDays(pickupDate, -1), ONLINE_CUTOFF_HOUR);

/** The exact cutoff instant counts as late. */
export const isBeforeOnlineCutoff = (pickupDate: CalendarDate, now: Date): boolean =>
    now.getTime() < getOnlineCutoff(pickupDate).getTime();

export const getBookingWindow = (
    source: ReservationSource,
    today: CalendarDate,
): { firstDate: CalendarDate; lastDate: CalendarDate } => ({
    firstDate: source === 'online' ? addDays(today, 1) : today,
    lastDate: addDays(today, BOOKING_WINDOW_DAYS),
});

export type BakerySchedule = {
    openWeekdays: ReadonlySet<number>;
    closures: ReadonlySet<CalendarDate>;
};

export const isBakeryOpen = (date: CalendarDate, schedule: BakerySchedule): boolean =>
    schedule.openWeekdays.has(getWeekday(date)) && !schedule.closures.has(date);

export type PickupDateRejectionReason =
    'INVALID_DATE' | 'OUTSIDE_BOOKING_WINDOW' | 'CUTOFF_PASSED' | 'BAKERY_CLOSED';

export const checkPickupDate = (input: {
    pickupDate: string;
    source: ReservationSource;
    now: Date;
    schedule: BakerySchedule;
}): { ok: true } | Rejection<PickupDateRejectionReason> => {
    const { pickupDate, source, now, schedule } = input;
    if (!isValidCalendarDate(pickupDate)) {
        return { ok: false, reason: 'INVALID_DATE' };
    }
    const { firstDate, lastDate } = getBookingWindow(source, getPragueDate(now));
    if (pickupDate < firstDate || pickupDate > lastDate) {
        return { ok: false, reason: 'OUTSIDE_BOOKING_WINDOW' };
    }
    if (source === 'online' && !isBeforeOnlineCutoff(pickupDate, now)) {
        return { ok: false, reason: 'CUTOFF_PASSED' };
    }
    if (!isBakeryOpen(pickupDate, schedule)) {
        return { ok: false, reason: 'BAKERY_CLOSED' };
    }
    return { ok: true };
};

export type ProductRejectionReason = 'PRODUCT_INACTIVE' | 'PRODUCT_NOT_OFFERED_ON_DATE';

/** An empty weekday list means the product is offered on every open day. */
export const checkProductOffered = (
    product: { active: boolean; weekdays: readonly number[] },
    pickupDate: CalendarDate,
): { ok: true } | Rejection<ProductRejectionReason> => {
    if (!product.active) {
        return { ok: false, reason: 'PRODUCT_INACTIVE' };
    }
    if (product.weekdays.length > 0 && !product.weekdays.includes(getWeekday(pickupDate))) {
        return { ok: false, reason: 'PRODUCT_NOT_OFFERED_ON_DATE' };
    }
    return { ok: true };
};

export type StatusTransitionRejectionReason =
    'INVALID_TRANSITION' | 'FORBIDDEN' | 'CUTOFF_PASSED' | 'BEFORE_PICKUP_DATE';

export type StatusTransitionResult =
    { ok: true; retainForProduction: boolean } | Rejection<StatusTransitionRejectionReason>;

/**
 * Only `confirmed` reservations can change status. Customers may only cancel, strictly before
 * the cutoff. Admin cancellation at or after the cutoff retains the production commitment.
 * Pickup outcomes are admin-only and allowed from the pickup date onwards.
 */
export const checkStatusTransition = (input: {
    from: ReservationStatus;
    to: ReservationStatus;
    actor: ReservationActor;
    pickupDate: CalendarDate;
    now: Date;
}): StatusTransitionResult => {
    const { from, to, actor, pickupDate, now } = input;
    if (from !== 'confirmed' || to === 'confirmed') {
        return { ok: false, reason: 'INVALID_TRANSITION' };
    }
    if (to === 'cancelled') {
        const isLate = !isBeforeOnlineCutoff(pickupDate, now);
        if (actor === 'customer' && isLate) {
            return { ok: false, reason: 'CUTOFF_PASSED' };
        }
        return { ok: true, retainForProduction: isLate };
    }
    if (actor !== 'admin') {
        return { ok: false, reason: 'FORBIDDEN' };
    }
    if (getPragueDate(now) < pickupDate) {
        return { ok: false, reason: 'BEFORE_PICKUP_DATE' };
    }
    return { ok: true, retainForProduction: false };
};
