'use client';

import Form from 'next/form';
import { SECONDARY_BUTTON_CLASSES, SELECTED_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { addDays } from '@/lib/date-time/prague';
import { DateTransitionStatus, TransitionLink, useDateTransition } from './date-transition';

/**
 * Previous/today/next links and a date picker, each loading `path?date=YYYY-MM-DD` in the
 * surrounding `DateTransitionProvider`'s transition, and a hint while that day loads.
 */
export const DateNavigation = ({
    path,
    date,
    today,
    label,
}: {
    path: string;
    date: string;
    today: string;
    /** Accessible name of the date picker. */
    label: string;
}) => {
    const { navigate } = useDateTransition();
    const dateHref = (target: string) => `${path}?date=${target}`;
    const inputId = `${path.replaceAll('/', '-').slice(1)}-date`;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <TransitionLink href={dateHref(addDays(date, -1))} className={SECONDARY_BUTTON_CLASSES}>
                ← Předchozí den
            </TransitionLink>
            <TransitionLink
                href={dateHref(today)}
                current={date === today}
                className={date === today ? SELECTED_BUTTON_CLASSES : SECONDARY_BUTTON_CLASSES}
            >
                Dnes
            </TransitionLink>
            <TransitionLink href={dateHref(addDays(date, 1))} className={SECONDARY_BUTTON_CLASSES}>
                Další den →
            </TransitionLink>
            <Form
                action={path}
                onSubmit={(event) => {
                    event.preventDefault();
                    const target = new FormData(event.currentTarget).get('date');
                    if (typeof target === 'string' && target !== '') {
                        navigate(dateHref(target));
                    }
                }}
                className="flex items-center gap-2"
            >
                <label htmlFor={inputId} className="sr-only">
                    {label}
                </label>
                <input
                    id={inputId}
                    type="date"
                    name="date"
                    defaultValue={date}
                    required
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2"
                />
                <button type="submit" className={SECONDARY_BUTTON_CLASSES}>
                    Zobrazit
                </button>
            </Form>
            <DateTransitionStatus />
        </div>
    );
};
