'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { DANGER_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { readProblemCode } from '@/lib/http/problem-code';
import { describeCancelFailure, type CancelFailureKind } from '@/lib/reservations/cancellation';

const FAILURE_MESSAGES: Record<CancelFailureKind, string> = {
    PICKUP_DATE_PASSED: 'Rezervaci se nepodařilo zrušit: den vyzvednutí už skončil.',
    NOT_CANCELLABLE: 'Rezervaci se nepodařilo zrušit: její stav se mezitím změnil.',
    NOT_FOUND: 'Rezervaci se nepodařilo najít.',
    RETRY: 'Rezervaci se nepodařilo zrušit. Zkuste to prosím znovu.',
};

// The server decides at each boundary itself; the margin absorbs small client clock offsets.
const BOUNDARY_REFRESH_MARGIN_MS = 1000;

/**
 * The cancellation card. Rendered for every status so it stays mounted when `router.refresh()`
 * replaces the reservation with its current state, and a failure message survives the refresh.
 * Every outcome refreshes, because a lost response may hide a cancellation that did commit.
 */
export const ReservationCancellation = ({
    token,
    canCancel,
    cancellationCutoff,
    cancellationDeadline,
    children,
}: {
    token: string;
    canCancel: boolean;
    /** ISO instants; the page refreshes when each passes, so the text and button stay current. */
    cancellationCutoff: string;
    cancellationDeadline: string;
    /** The server's description of the current state. */
    children: React.ReactNode;
}) => {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<CancelFailureKind | null>(null);
    const [pending, startTransition] = useTransition();

    useEffect(() => {
        if (!canCancel) {
            return;
        }
        const now = Date.now();
        const cutoff = new Date(cancellationCutoff).getTime();
        const nextBoundary = now < cutoff ? cutoff : new Date(cancellationDeadline).getTime();
        const timer = setTimeout(
            () => router.refresh(),
            nextBoundary - now + BOUNDARY_REFRESH_MARGIN_MS,
        );
        return () => clearTimeout(timer);
    }, [canCancel, cancellationCutoff, cancellationDeadline, router]);

    const cancel = () => {
        setFailure(null);
        startTransition(async () => {
            try {
                const response = await fetch(
                    `/api/reservations/manage/${encodeURIComponent(token)}/cancel`,
                    { method: 'POST', cache: 'no-store' },
                );
                if (!response.ok) {
                    const body: unknown = await response.json().catch(() => null);
                    setFailure(describeCancelFailure(readProblemCode(body)));
                }
            } catch {
                setFailure('RETRY');
            }
            setConfirming(false);
            router.refresh();
        });
    };

    // A retry only makes sense while the refreshed reservation can still be cancelled.
    const visibleFailure = failure === 'RETRY' && !canCancel ? null : failure;
    return (
        <section
            aria-labelledby="cancellation-heading"
            className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
        >
            <h2 id="cancellation-heading" className="text-lg font-semibold text-amber-950">
                Zrušení
            </h2>
            {visibleFailure && <Notice tone="warning">{FAILURE_MESSAGES[visibleFailure]}</Notice>}
            <p className="text-sm text-stone-600">{children}</p>
            {canCancel &&
                (confirming ? (
                    <div className="flex flex-col gap-3">
                        <p className="font-medium text-amber-950">
                            Opravdu chcete rezervaci zrušit?
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={cancel}
                                disabled={pending}
                                className={DANGER_BUTTON_CLASSES}
                            >
                                {pending ? 'Rušíme…' : 'Ano, zrušit rezervaci'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirming(false)}
                                disabled={pending}
                                className={SECONDARY_BUTTON_CLASSES}
                            >
                                Ponechat
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <button
                            type="button"
                            onClick={() => setConfirming(true)}
                            className={SECONDARY_BUTTON_CLASSES}
                        >
                            Zrušit rezervaci
                        </button>
                    </div>
                ))}
        </section>
    );
};
