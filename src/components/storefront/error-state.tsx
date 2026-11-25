'use client';

import Link from 'next/link';
import { useEffect, useId } from 'react';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';

/**
 * Fallback for an unexpected failure such as an unreachable database. Server errors reach the
 * browser only as a digest, so nothing sensitive is shown; Next logs the same digest with the
 * error on the server.
 */
export const ErrorState = ({
    error,
    retry,
    heading,
    headingLevel: Heading,
    message,
}: {
    error: unknown;
    retry: () => void;
    heading: string;
    /** `h2` below a layout that already has the page's `h1`. */
    headingLevel: 'h1' | 'h2';
    message: string;
}) => {
    const headingId = useId();
    useEffect(() => {
        console.error(error);
    }, [error]);
    return (
        <section aria-labelledby={headingId} className="flex flex-col items-start gap-4">
            <Heading
                id={headingId}
                className="text-2xl font-semibold tracking-tight text-amber-950"
            >
                {heading}
            </Heading>
            <Notice tone="warning">{message}</Notice>
            <div className="flex flex-wrap gap-3">
                <button type="button" onClick={retry} className={SECONDARY_BUTTON_CLASSES}>
                    Zkusit znovu
                </button>
                <Link href="/" className={SECONDARY_BUTTON_CLASSES}>
                    Zpět na úvod
                </Link>
            </div>
        </section>
    );
};
