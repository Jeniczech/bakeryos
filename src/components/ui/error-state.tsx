'use client';

import Link from 'next/link';
import { useEffect, useId } from 'react';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import {
    isOutdatedDeploymentError,
    OUTDATED_DEPLOYMENT_HEADING,
    OUTDATED_DEPLOYMENT_MESSAGE,
    RELOAD_PAGE_LABEL,
    reloadPage,
} from '@/components/ui/outdated-deployment';

/**
 * Fallback for an unexpected failure such as an unreachable database. Server errors reach the
 * browser only as a digest, so nothing sensitive is shown; Next logs the same digest with the
 * error on the server. A Server Action outdated by a deployment gets its own message and a full
 * reload, because `retry` would keep the outdated action.
 */
export const ErrorState = ({
    error,
    retry,
    heading,
    headingLevel: Heading,
    message,
    homeHref = '/',
}: {
    error: unknown;
    retry: () => void;
    heading: string;
    /** `h2` below a layout that already has the page's `h1`. */
    headingLevel: 'h1' | 'h2';
    message: string;
    homeHref?: string;
}) => {
    const headingId = useId();
    useEffect(() => {
        console.error(error);
    }, [error]);
    const outdated = isOutdatedDeploymentError(error);
    return (
        <section aria-labelledby={headingId} className="flex flex-col items-start gap-4">
            <Heading
                id={headingId}
                className="text-2xl font-semibold tracking-tight text-amber-950"
            >
                {outdated ? OUTDATED_DEPLOYMENT_HEADING : heading}
            </Heading>
            <Notice tone="warning">{outdated ? OUTDATED_DEPLOYMENT_MESSAGE : message}</Notice>
            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={outdated ? reloadPage : retry}
                    className={SECONDARY_BUTTON_CLASSES}
                >
                    {outdated ? RELOAD_PAGE_LABEL : 'Zkusit znovu'}
                </button>
                <Link href={homeHref} className={SECONDARY_BUTTON_CLASSES}>
                    Zpět na úvod
                </Link>
            </div>
        </section>
    );
};
