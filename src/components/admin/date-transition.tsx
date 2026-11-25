'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, use, useTransition } from 'react';

type DateTransitionValue = {
    pending: boolean;
    navigate: (href: string) => void;
};

const DateTransitionContext = createContext<DateTransitionValue | null>(null);

export const useDateTransition = (): DateTransitionValue => {
    const value = use(DateTransitionContext);
    if (!value) {
        throw new Error('useDateTransition must be used within DateTransitionProvider');
    }
    return value;
};

/**
 * Runs date navigations in a transition, so the page can show that the next day is loading
 * while the current one stays on screen until the server responds.
 */
export const DateTransitionProvider = ({ children }: { children: React.ReactNode }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const navigate = (href: string) => startTransition(() => router.push(href));
    return <DateTransitionContext value={{ pending, navigate }}>{children}</DateTransitionContext>;
};

/** Dims the day's content, and makes it inert (no clicks, focus, or reading), while another day loads. */
export const DateTransitionContent = ({ children }: { children: React.ReactNode }) => {
    const { pending } = useDateTransition();
    return (
        <div
            inert={pending}
            className={`flex flex-col gap-4 transition-opacity ${pending ? 'opacity-50 delay-200' : ''}`}
        >
            {children}
        </div>
    );
};

/** A link whose plain clicks navigate in the transition; modified clicks (new tab etc.) behave as usual. */
export const TransitionLink = ({
    href,
    className,
    current,
    children,
}: {
    href: string;
    className: string;
    /** Marks the link as the selected date. */
    current?: boolean;
    children: React.ReactNode;
}) => {
    const { navigate } = useDateTransition();
    return (
        <Link
            href={href}
            onNavigate={(event) => {
                event.preventDefault();
                navigate(href);
            }}
            aria-current={current ? 'date' : undefined}
            className={className}
        >
            {children}
        </Link>
    );
};

/** Announces, and shows beside the date controls, that another day is loading. */
export const DateTransitionStatus = () => {
    const { pending } = useDateTransition();
    return (
        <span role="status" className="animate-pulse text-sm text-stone-600">
            {pending && 'Načítáme…'}
        </span>
    );
};
