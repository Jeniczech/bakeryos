'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';
import { useCheckout } from './checkout-provider';
import { PICKUP_DATE_LABELS } from './pickup-date-messages';

/** A pickup date with its labels already formatted on the server. */
export type PickupDateChoice = {
    date: string;
    weekday: string;
    dayMonth: string;
    unavailableReason: PickupDateRejectionReason | null;
};

export const PickupDatePicker = ({ dates }: { dates: readonly PickupDateChoice[] }) => {
    // Read on the client: the layout this lives in does not re-render when the date changes.
    const selectedDate = useParams<{ date?: string }>().date ?? null;
    // A date switch during a submission would replace its navigation to the confirmation.
    const { submitting } = useCheckout();
    return (
        <nav aria-labelledby="pickup-date-heading" className="flex flex-col gap-3">
            <h2 id="pickup-date-heading" className="text-lg font-semibold text-amber-950">
                Den vyzvednutí
            </h2>
            <ul className="grid auto-rows-fr grid-cols-4 gap-2 sm:grid-cols-7">
                {dates.map(({ date, weekday, dayMonth, unavailableReason }) => {
                    const label = (
                        <>
                            <span className="text-sm font-medium">{weekday}</span>
                            <span className="text-base font-semibold">{dayMonth}</span>
                        </>
                    );
                    if (unavailableReason) {
                        return (
                            <li key={date}>
                                <span
                                    aria-disabled="true"
                                    className="flex h-full flex-col items-center rounded-lg border border-stone-200 bg-stone-100 px-2 py-2 text-stone-400"
                                >
                                    {label}
                                    <span className="text-xs">
                                        {PICKUP_DATE_LABELS[unavailableReason]}
                                    </span>
                                </span>
                            </li>
                        );
                    }
                    const isSelected = date === selectedDate;
                    return (
                        <li key={date}>
                            <Link
                                href={`/den/${date}`}
                                scroll={false}
                                // Resolves each date's cached catalog before the click.
                                prefetch
                                aria-current={isSelected ? 'date' : undefined}
                                aria-disabled={submitting || undefined}
                                onClick={submitting ? (event) => event.preventDefault() : undefined}
                                className={`flex h-full flex-col items-center rounded-lg border px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${
                                    isSelected
                                        ? 'border-amber-800 bg-amber-800 text-white'
                                        : 'border-amber-200 bg-white text-amber-950 hover:border-amber-400 hover:bg-amber-100'
                                }`}
                            >
                                {label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
};
