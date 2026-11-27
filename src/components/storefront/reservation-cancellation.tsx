'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { DANGER_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { readProblemCode } from '@/lib/http/problem-code';
import { describeCancelFailure, type CancelFailureKind } from '@/lib/reservations/cancellation';

const FAILURE_MESSAGES: Record<CancelFailureKind, string> = {
    CUTOFF_PASSED: 'Rezervaci se nepodařilo zrušit: termín pro online zrušení už uplynul. Pokud nemůžete přijít, zavolejte prosím do pekárny.',
    NOT_CANCELLABLE: 'Rezervaci se nepodařilo zrušit: její stav se mezitím změnil.',
    NOT_FOUND: 'Rezervaci se nepodařilo najít.',
    RETRY: 'Rezervaci se nepodařilo zrušit. Zkuste to prosím znovu.',
};

// The server decides at the cutoff itself; the margin absorbs small client clock offsets.
const CUTOFF_REFRESH_MARGIN_MS = 1000;

/**
 * The cancellation card. Rendered for every status so it stays mounted when `router.refresh()`
 * replaces the reservation with its current state, and a failure message survives the refresh.
 * Every outcome refreshes, because a lost response may hide a cancellation that did commit.
 */
export const ReservationCancellation = ({
    token,
    canCancel,
    cancellationCutoff,
    children,
}: {
    token: string;
    canCancel: boolean;
    /** ISO instant; the page refreshes when it passes, so stale buttons disappear. */
    cancellationCutoff: string;
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
        const delay = new Date(cancellationCutoff).getTime() - Date.now();
        const timer = setTimeout(() => router.refresh(), delay + CUTOFF_REFRESH_MARGIN_MS);
        return () => clearTimeout(timer);
    }, [canCancel, cancellationCutoff, router]);

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
