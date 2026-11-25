'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DANGER_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { readProblemCode } from '@/lib/http/problem-code';
import { describeCancelFailure, type CancelFailureKind } from '@/lib/reservations/cancellation';

const FAILURE_MESSAGES: Record<CancelFailureKind, string> = {
    CUTOFF_PASSED: 'Termín pro zrušení už uplynul, online ji zrušit nelze.',
    NOT_CANCELLABLE: 'Tuto rezervaci už nelze zrušit.',
    NOT_FOUND: 'Rezervaci se nepodařilo najít.',
    RETRY: 'Rezervaci se nepodařilo zrušit. Zkuste to prosím znovu.',
};

/**
 * Cancels through the public API after an explicit confirmation, then refreshes the page so
 * the server renders the reservation's new state. A repeated request is harmless: the server
 * cancels at most once.
 */
export const CancelReservationButton = ({ token }: { token: string }) => {
    const router = useRouter();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<CancelFailureKind | null>(null);
    const [pending, startTransition] = useTransition();

    const cancel = () => {
        setFailure(null);
        startTransition(async () => {
            let code: string | null = null;
            try {
                const response = await fetch(
                    `/api/reservations/manage/${encodeURIComponent(token)}/cancel`,
                    { method: 'POST', cache: 'no-store' },
                );
                if (response.ok) {
                    router.refresh();
                    return;
                }
                code = readProblemCode(await response.json().catch(() => null));
            } catch {
                // A network error is retried by the customer; `code` stays null.
            }
            const { kind, refreshPage } = describeCancelFailure(code);
            setFailure(kind);
            setConfirming(false);
            if (refreshPage) {
                router.refresh();
            }
        });
    };

    return (
        <div className="flex flex-col gap-3">
            {confirming ? (
                <div className="flex flex-col gap-3">
                    <p className="font-medium text-amber-950">Opravdu chcete rezervaci zrušit?</p>
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
            )}
            {failure && <Notice tone="warning">{FAILURE_MESSAGES[failure]}</Notice>}
        </div>
    );
};
