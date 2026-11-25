'use client';

import { useRouter } from 'next/navigation';
import { createContext, use, useOptimistic, useTransition } from 'react';

type SelectedDateState = {
    /** The date the server rendered the page for. */
    renderedDate: string | null;
    /** The date the customer picked; ahead of `renderedDate` while its page is loading. */
    selectedDate: string | null;
    selectDate: (date: string, href: string) => void;
};

const SelectedDateContext = createContext<SelectedDateState | null>(null);

export const useSelectedDate = (): SelectedDateState => {
    const state = use(SelectedDateContext);
    if (!state) {
        throw new Error('useSelectedDate must be used inside SelectedDateProvider');
    }
    return state;
};

/**
 * Shows the picked date immediately, while the server renders its catalog. The optimistic value
 * falls back to `renderedDate` once the navigation commits, or if it fails.
 */
export const SelectedDateProvider = ({
    renderedDate,
    children,
}: {
    renderedDate: string | null;
    children: React.ReactNode;
}) => {
    const router = useRouter();
    const [selectedDate, setSelectedDate] = useOptimistic(renderedDate);
    const [, startTransition] = useTransition();

    const selectDate = (date: string, href: string) => {
        startTransition(() => {
            setSelectedDate(date);
            router.push(href, { scroll: false });
        });
    };

    return (
        <SelectedDateContext value={{ renderedDate, selectedDate, selectDate }}>
            {children}
        </SelectedDateContext>
    );
};

/** Hides the previous date's content until the picked date's page arrives. */
export const SelectedDateContent = ({
    pending,
    children,
}: {
    pending: React.ReactNode;
    children: React.ReactNode;
}) => {
    const { renderedDate, selectedDate } = useSelectedDate();
    return selectedDate === renderedDate ? children : pending;
};
