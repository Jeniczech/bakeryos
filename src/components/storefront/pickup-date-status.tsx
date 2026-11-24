import { connection } from 'next/server';
import { Notice } from '@/components/ui/notice';
import { getPickupDates } from '@/server/services/eligibility';
import { PICKUP_DATE_MESSAGES } from './pickup-date-messages';

/** Warns when the selected date cannot be booked online right now; renders nothing otherwise. */
export const PickupDateStatus = async ({ pickupDate }: { pickupDate: string }) => {
    await connection();
    const dates = await getPickupDates('online');
    const option = dates.find((candidate) => candidate.date === pickupDate);
    const reason = option ? option.unavailableReason : 'OUTSIDE_BOOKING_WINDOW';
    return reason ? <Notice tone="warning">{PICKUP_DATE_MESSAGES[reason]}</Notice> : null;
};
