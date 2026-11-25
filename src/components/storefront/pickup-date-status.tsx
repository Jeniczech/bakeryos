import { connection } from 'next/server';
import { cache } from 'react';
import { Notice } from '@/components/ui/notice';
import { getPickupDates } from '@/server/services/eligibility';
import { PICKUP_DATE_MESSAGES } from './pickup-date-messages';

/**
 * The online pickup dates, loaded once per request and shared by the date picker and the
 * status. Callers must `await connection()` first, because this reads the clock.
 */
export const getOnlinePickupDates = cache(() => getPickupDates());

/** Warns when the selected date cannot be booked online right now; renders nothing otherwise. */
export const PickupDateStatus = async ({ pickupDate }: { pickupDate: string }) => {
    await connection();
    const dates = await getOnlinePickupDates();
    const option = dates.find((candidate) => candidate.date === pickupDate);
    const reason = option ? option.unavailableReason : 'OUTSIDE_BOOKING_WINDOW';
    return reason ? <Notice tone="warning">{PICKUP_DATE_MESSAGES[reason]}</Notice> : null;
};
