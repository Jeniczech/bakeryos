import { describe, expect, it } from 'vitest';
import {
    checkPickupDate,
    checkPlanDate,
    checkProductOffered,
    checkStatusTransition,
    getBookingWindow,
    getCancellationDeadline,
    getPlanningWindow,
    getReservationCutoff,
    isBakeryOpen,
    isBeforeReservationCutoff,
    listPickupDates,
    type BakerySchedule,
    type ReservationStatus,
} from '@/server/domain/reservation-rules';

// Tuesday 2026-11-24, 11:00 in Prague (UTC+1).
const tuesdayMorning = new Date('2026-11-24T10:00:00Z');
// Cutoff for Wednesday 2026-11-25 pickup: Tuesday 18:00 Prague.
const wednesdayCutoff = new Date('2026-11-24T17:00:00Z');
const justBefore = (instant: Date) => new Date(instant.getTime() - 1);

const closedOnMondays: BakerySchedule = {
    openWeekdays: new Set([0, 2, 3, 4, 5, 6]),
    closures: new Set(['2026-11-28']),
};
const alwaysOpen: BakerySchedule = {
    openWeekdays: new Set([0, 1, 2, 3, 4, 5, 6]),
    closures: new Set(),
};

describe('getCancellationDeadline', () => {
    it('is Prague midnight ending the pickup date', () => {
        expect(getCancellationDeadline('2026-11-25').toISOString()).toBe(
            '2026-11-25T23:00:00.000Z',
        );
        expect(getCancellationDeadline('2026-07-02').toISOString()).toBe(
            '2026-07-02T22:00:00.000Z',
        );
        // Clocks go back on Sunday 2026-10-25.
        expect(getCancellationDeadline('2026-10-25').toISOString()).toBe(
            '2026-10-25T23:00:00.000Z',
        );
    });
});

describe('getReservationCutoff', () => {
    it('is 18:00 Prague time on the previous calendar day', () => {
        expect(getReservationCutoff('2026-11-25')).toEqual(wednesdayCutoff);
        expect(getReservationCutoff('2026-07-02').toISOString()).toBe('2026-07-01T16:00:00.000Z');
        expect(getReservationCutoff('2027-01-01').toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('follows the wall clock across the spring daylight-saving change', () => {
        // Clocks go forward on Sunday 2026-03-29.
        expect(getReservationCutoff('2026-03-29').toISOString()).toBe('2026-03-28T17:00:00.000Z');
        expect(getReservationCutoff('2026-03-30').toISOString()).toBe('2026-03-29T16:00:00.000Z');
    });

    it('follows the wall clock across the autumn daylight-saving change', () => {
        // Clocks go back on Sunday 2026-10-25.
        expect(getReservationCutoff('2026-10-25').toISOString()).toBe('2026-10-24T16:00:00.000Z');
        expect(getReservationCutoff('2026-10-26').toISOString()).toBe('2026-10-25T17:00:00.000Z');
    });
});

describe('isBeforeReservationCutoff', () => {
    it('is true before 18:00 and false exactly at and after 18:00', () => {
        expect(isBeforeReservationCutoff('2026-11-25', justBefore(wednesdayCutoff))).toBe(true);
        expect(isBeforeReservationCutoff('2026-11-25', wednesdayCutoff)).toBe(false);
        expect(isBeforeReservationCutoff('2026-11-25', new Date('2026-11-24T17:00:01Z'))).toBe(
            false,
        );
    });

    it('applies the exact boundary on daylight-saving transition days', () => {
        const springCutoff = new Date('2026-03-29T16:00:00Z');
        expect(isBeforeReservationCutoff('2026-03-30', justBefore(springCutoff))).toBe(true);
        expect(isBeforeReservationCutoff('2026-03-30', springCutoff)).toBe(false);

        const autumnCutoff = new Date('2026-10-25T17:00:00Z');
        expect(isBeforeReservationCutoff('2026-10-26', justBefore(autumnCutoff))).toBe(true);
        expect(isBeforeReservationCutoff('2026-10-26', autumnCutoff)).toBe(false);
    });
});

describe('getBookingWindow', () => {
    it('is today+1 to today+7 for every reservation', () => {
        expect(getBookingWindow('2026-11-24')).toEqual({
            firstDate: '2026-11-25',
            lastDate: '2026-12-01',
        });
    });
});

describe('getPlanningWindow', () => {
    it('is today to today+7 for daily plan edits', () => {
        expect(getPlanningWindow('2026-11-24')).toEqual({
            firstDate: '2026-11-24',
            lastDate: '2026-12-01',
        });
    });
});

describe('isBakeryOpen', () => {
    it('respects weekly opening days and closures', () => {
        expect(isBakeryOpen('2026-11-24', closedOnMondays)).toBe(true);
        expect(isBakeryOpen('2026-11-30', closedOnMondays)).toBe(false);
        expect(isBakeryOpen('2026-11-28', closedOnMondays)).toBe(false);
    });
});

describe('checkPickupDate', () => {
    const check = (pickupDate: string, now = tuesdayMorning) =>
        checkPickupDate({ pickupDate, now, schedule: closedOnMondays });

    it('rejects an invalid date', () => {
        expect(check('2026-11-31')).toEqual({ ok: false, reason: 'INVALID_DATE' });
    });

    it('rejects past dates and today', () => {
        expect(check('2026-11-23')).toEqual({
            ok: false,
            reason: 'OUTSIDE_BOOKING_WINDOW',
        });
        expect(check('2026-11-24')).toEqual({
            ok: false,
            reason: 'OUTSIDE_BOOKING_WINDOW',
        });
    });

    it('accepts tomorrow until just before the cutoff', () => {
        expect(check('2026-11-25')).toEqual({ ok: true });
        expect(check('2026-11-25', justBefore(wednesdayCutoff))).toEqual({
            ok: true,
        });
    });

    it('rejects tomorrow exactly at and after the cutoff', () => {
        expect(check('2026-11-25', wednesdayCutoff)).toEqual({
            ok: false,
            reason: 'CUTOFF_PASSED',
        });
        expect(check('2026-11-25', new Date('2026-11-24T22:00:00Z'))).toEqual({
            ok: false,
            reason: 'CUTOFF_PASSED',
        });
    });

    it('accepts today+7 and rejects today+8', () => {
        expect(check('2026-12-01')).toEqual({ ok: true });
        expect(check('2026-12-02')).toEqual({
            ok: false,
            reason: 'OUTSIDE_BOOKING_WINDOW',
        });
    });

    it('rejects closed weekdays and closure dates', () => {
        expect(check('2026-11-30')).toEqual({ ok: false, reason: 'BAKERY_CLOSED' });
        expect(check('2026-11-28')).toEqual({ ok: false, reason: 'BAKERY_CLOSED' });
    });

    it('uses the Prague date for "today" shortly after Prague midnight', () => {
        // 00:30 on Wednesday 2026-11-25 in Prague, still Tuesday in UTC.
        const afterPragueMidnight = new Date('2026-11-24T23:30:00Z');
        expect(check('2026-11-25', afterPragueMidnight)).toEqual({
            ok: false,
            reason: 'OUTSIDE_BOOKING_WINDOW',
        });
        expect(check('2026-11-26', afterPragueMidnight)).toEqual({ ok: true });
        expect(check('2026-12-02', afterPragueMidnight)).toEqual({ ok: true });
    });

    it('applies the cutoff across a daylight-saving change', () => {
        const springCutoff = new Date('2026-03-29T16:00:00Z');
        const at = (now: Date) =>
            checkPickupDate({
                pickupDate: '2026-03-30',
                now,
                schedule: alwaysOpen,
            });
        expect(at(justBefore(springCutoff))).toEqual({ ok: true });
        expect(at(springCutoff)).toEqual({ ok: false, reason: 'CUTOFF_PASSED' });
    });
});

describe('checkPlanDate', () => {
    const check = (date: string, now = tuesdayMorning) =>
        checkPlanDate({ date, now, schedule: closedOnMondays });

    it('accepts today, including after the cutoff', () => {
        expect(check('2026-11-24')).toEqual({ ok: true });
        expect(check('2026-11-24', new Date('2026-11-24T20:00:00Z'))).toEqual({ ok: true });
        expect(check('2026-11-25', wednesdayCutoff)).toEqual({ ok: true });
    });

    it('rejects an invalid date and past dates', () => {
        expect(check('2026-11-31')).toEqual({ ok: false, reason: 'INVALID_DATE' });
        expect(check('2026-11-23')).toEqual({ ok: false, reason: 'OUTSIDE_BOOKING_WINDOW' });
    });

    it('accepts today+7 and rejects today+8', () => {
        expect(check('2026-12-01')).toEqual({ ok: true });
        expect(check('2026-12-02')).toEqual({ ok: false, reason: 'OUTSIDE_BOOKING_WINDOW' });
    });

    it('respects opening days and closures', () => {
        expect(check('2026-11-30')).toEqual({ ok: false, reason: 'BAKERY_CLOSED' });
        expect(check('2026-11-28')).toEqual({ ok: false, reason: 'BAKERY_CLOSED' });
    });
});

describe('listPickupDates', () => {
    const list = (now = tuesdayMorning) => listPickupDates({ now, schedule: closedOnMondays });

    it('lists tomorrow through today+7, flagging closed days', () => {
        expect(list()).toEqual([
            { date: '2026-11-25', unavailableReason: null },
            { date: '2026-11-26', unavailableReason: null },
            { date: '2026-11-27', unavailableReason: null },
            { date: '2026-11-28', unavailableReason: 'BAKERY_CLOSED' },
            { date: '2026-11-29', unavailableReason: null },
            { date: '2026-11-30', unavailableReason: 'BAKERY_CLOSED' },
            { date: '2026-12-01', unavailableReason: null },
        ]);
    });

    it('flags tomorrow once its cutoff has passed', () => {
        expect(list(wednesdayCutoff)[0]).toEqual({
            date: '2026-11-25',
            unavailableReason: 'CUTOFF_PASSED',
        });
    });
});

describe('checkProductOffered', () => {
    it('offers an active product without weekday restrictions on any date', () => {
        expect(checkProductOffered({ active: true, weekdays: [] }, '2026-11-25')).toEqual({
            ok: true,
        });
    });

    it('offers a restricted product only on its weekdays', () => {
        const fridayAndSaturday = { active: true, weekdays: [5, 6] };
        expect(checkProductOffered(fridayAndSaturday, '2026-11-27')).toEqual({ ok: true });
        expect(checkProductOffered(fridayAndSaturday, '2026-11-25')).toEqual({
            ok: false,
            reason: 'PRODUCT_NOT_OFFERED_ON_DATE',
        });
    });

    it('rejects inactive products', () => {
        expect(checkProductOffered({ active: false, weekdays: [] }, '2026-11-25')).toEqual({
            ok: false,
            reason: 'PRODUCT_INACTIVE',
        });
    });
});

describe('checkStatusTransition', () => {
    const transition = (
        to: ReservationStatus,
        actor: 'customer' | 'admin',
        now: Date,
        from: ReservationStatus = 'confirmed',
    ) => checkStatusTransition({ from, to, actor, pickupDate: '2026-11-25', now });

    describe('cancellation', () => {
        it('lets a customer cancel strictly before the cutoff, releasing capacity', () => {
            expect(transition('cancelled', 'customer', justBefore(wednesdayCutoff))).toEqual({
                ok: true,
                retainForProduction: false,
            });
        });

        it('retains production for a customer cancellation at or after the cutoff', () => {
            expect(transition('cancelled', 'customer', wednesdayCutoff)).toEqual({
                ok: true,
                retainForProduction: true,
            });
            expect(transition('cancelled', 'customer', new Date('2026-11-25T09:00:00Z'))).toEqual({
                ok: true,
                retainForProduction: true,
            });
        });

        it('releases capacity for an early admin cancellation', () => {
            expect(transition('cancelled', 'admin', justBefore(wednesdayCutoff))).toEqual({
                ok: true,
                retainForProduction: false,
            });
        });

        it('retains production for an admin cancellation at or after the cutoff', () => {
            expect(transition('cancelled', 'admin', wednesdayCutoff)).toEqual({
                ok: true,
                retainForProduction: true,
            });
            expect(transition('cancelled', 'admin', new Date('2026-11-25T09:00:00Z'))).toEqual({
                ok: true,
                retainForProduction: true,
            });
        });
    });

    describe('past pickup dates', () => {
        // Prague midnight ending the pickup date.
        const dayAfterPickup = new Date('2026-11-25T23:00:00Z');

        it.each(['customer', 'admin'] as const)(
            'rejects %s cancellation once the pickup date has passed',
            (actor) => {
                expect(transition('cancelled', actor, justBefore(dayAfterPickup))).toEqual({
                    ok: true,
                    retainForProduction: true,
                });
                expect(transition('cancelled', actor, dayAfterPickup)).toEqual({
                    ok: false,
                    reason: 'PICKUP_DATE_PASSED',
                });
            },
        );

        it.each(['picked_up', 'no_show'] as const)('still allows admin %s', (to) => {
            expect(transition(to, 'admin', dayAfterPickup)).toEqual({
                ok: true,
                retainForProduction: false,
            });
        });
    });

    describe('pickup outcomes', () => {
        // Prague midnight starting the pickup date.
        const pickupDayStart = new Date('2026-11-24T23:00:00Z');

        it.each(['picked_up', 'no_show'] as const)(
            'allows admin %s from the pickup date onwards',
            (to) => {
                expect(transition(to, 'admin', pickupDayStart)).toEqual({
                    ok: true,
                    retainForProduction: false,
                });
                expect(transition(to, 'admin', new Date('2026-11-27T09:00:00Z'))).toEqual({
                    ok: true,
                    retainForProduction: false,
                });
            },
        );

        it.each(['picked_up', 'no_show'] as const)('rejects %s before the pickup date', (to) => {
            expect(transition(to, 'admin', justBefore(pickupDayStart))).toEqual({
                ok: false,
                reason: 'BEFORE_PICKUP_DATE',
            });
        });

        it.each(['picked_up', 'no_show'] as const)('forbids customers from %s', (to) => {
            expect(transition(to, 'customer', pickupDayStart)).toEqual({
                ok: false,
                reason: 'FORBIDDEN',
            });
        });
    });

    describe('terminal statuses', () => {
        const terminal = ['picked_up', 'cancelled', 'no_show'] as const;
        const targets = ['confirmed', 'picked_up', 'cancelled', 'no_show'] as const;

        it.each(terminal.flatMap((from) => targets.map((to) => [from, to] as const)))(
            'rejects %s → %s',
            (from, to) => {
                expect(transition(to, 'admin', new Date('2026-11-25T09:00:00Z'), from)).toEqual({
                    ok: false,
                    reason: 'INVALID_TRANSITION',
                });
            },
        );

        it('rejects confirmed → confirmed', () => {
            expect(transition('confirmed', 'admin', tuesdayMorning)).toEqual({
                ok: false,
                reason: 'INVALID_TRANSITION',
            });
        });
    });
});
