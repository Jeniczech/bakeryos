'use client';

import Link from 'next/link';
import type { PickupDateRejectionReason } from '@/server/domain/reservation-rules';
import { PICKUP_DATE_LABELS } from './pickup-date-messages';
import { useSelectedDate } from './selected-date';

export type PickupDateChoice = {
    date: string;
    weekday: string;
    dayMonth: string;
    unavailableReason: PickupDateRejectionReason | null;
};

export const PickupDatePicker = ({ dates }: { dates: readonly PickupDateChoice[] }) => {
    const { selectedDate, selectDate } = useSelectedDate();
    return (
        <nav aria-labelledby="pickup-date-heading" className="flex flex-col gap-3">
            <h2 id="pickup-date-heading" className="text-lg font-semibold text-amber-950">
                Den vyzvednutí
            </h2>
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7">
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
                    const href = `/?date=${date}`;
                    const isSelected = date === selectedDate;
                    return (
                        <li key={date}>
                            <Link
                                href={href}
                                onNavigate={(event) => {
                                    event.preventDefault();
                                    selectDate(date, href);
                                }}
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
