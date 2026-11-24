'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { formatShortDate } from '@/lib/formatting/dates';
import type { PickupDateOption } from '@/server/domain/reservation-rules';
import { PICKUP_DATE_LABELS } from './pickup-date-messages';

export const PickupDatePicker = ({ dates }: { dates: readonly PickupDateOption[] }) => {
    // Read on the client: search-param changes do not re-render the layout this lives in.
    const selectedDate = useSearchParams().get('date');
    return (
        <nav aria-labelledby="pickup-date-heading" className="flex flex-col gap-3">
            <h2 id="pickup-date-heading" className="text-lg font-semibold text-amber-950">
                Den vyzvednutí
            </h2>
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {dates.map(({ date, unavailableReason }) => {
                    const { weekday, dayMonth } = formatShortDate(date);
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
                                href={{ pathname: '/', query: { date } }}
                                scroll={false}
                                // Resolves each date's cached catalog before the click.
                                prefetch
                                aria-current={isSelected ? 'date' : undefined}
                                className={`flex h-full flex-col items-center rounded-lg border px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 ${
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
