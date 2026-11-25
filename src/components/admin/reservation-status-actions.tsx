'use client';

import { useActionState } from 'react';
import {
    changeReservationStatus,
    type StatusChangeError,
} from '@/app/admin/(dashboard)/reservations/actions';
import { DANGER_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import type { AdminStatusTarget } from '@/server/domain/reservation-rules';

const ERROR_MESSAGES: Record<StatusChangeError, string> = {
    INVALID_TRANSITION: 'Stav rezervace se mezitím změnil.',
    FORBIDDEN: 'Tuto změnu nelze provést.',
    CUTOFF_PASSED: 'Termín pro zrušení už uplynul.',
    BEFORE_PICKUP_DATE: 'Vyzvednutí lze označit až v den vyzvednutí.',
    PICKUP_DATE_PASSED: 'Rezervace s minulým datem vyzvednutí už nelze měnit.',
    NOT_FOUND: 'Rezervace nebyla nalezena.',
    INVALID_REQUEST: 'Neplatný požadavek.',
    UNAVAILABLE: 'Změnu se nepodařilo uložit. Zkuste to prosím znovu.',
};

const BUTTON_LABELS: Record<AdminStatusTarget, string> = {
    picked_up: 'Vyzvednuto',
    no_show: 'Nevyzvednuto',
    cancelled: 'Zrušit',
};

export const ReservationStatusActions = ({
    reservationId,
    reservationNumber,
    allowedTargets,
    cancellationRetainsProduction,
}: {
    reservationId: string;
    reservationNumber: string;
    allowedTargets: readonly AdminStatusTarget[];
    /** Whether a cancellation now is late, so the items stay in production. */
    cancellationRetainsProduction: boolean;
}) => {
    const [state, formAction, pending] = useActionState(changeReservationStatus, { error: null });

    const confirmCancellation = (event: React.MouseEvent<HTMLButtonElement>) => {
        const consequence = cancellationRetainsProduction
            ? 'Po uzávěrce zůstanou položky započítané ve výrobě.'
            : 'Kapacita se uvolní pro další rezervace.';
        if (!window.confirm(`Opravdu zrušit rezervaci ${reservationNumber}? ${consequence}`)) {
            event.preventDefault();
        }
    };

    if (allowedTargets.length === 0 && !state.error) {
        return null;
    }
    return (
        <form action={formAction} className="flex flex-col items-start gap-2">
            <input type="hidden" name="reservationId" value={reservationId} />
            <div className="flex flex-wrap gap-2">
                {allowedTargets.map((target) => (
                    <button
                        key={target}
                        type="submit"
                        name="status"
                        value={target}
                        disabled={pending}
                        onClick={target === 'cancelled' ? confirmCancellation : undefined}
                        className={
                            target === 'cancelled'
                                ? DANGER_BUTTON_CLASSES
                                : SECONDARY_BUTTON_CLASSES
                        }
                    >
                        {BUTTON_LABELS[target]}
                    </button>
                ))}
            </div>
            {state.error && (
                <p role="alert" className="text-sm text-red-800">
                    {ERROR_MESSAGES[state.error]}
                </p>
            )}
        </form>
    );
};
