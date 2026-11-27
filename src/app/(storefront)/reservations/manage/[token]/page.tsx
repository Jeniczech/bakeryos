import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ReservationCancellation } from '@/components/storefront/reservation-cancellation';
import { ReservationItems } from '@/components/storefront/reservation-items';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { formatLongDate, formatPragueDateTimeWithPreposition } from '@/lib/formatting/dates';
import { ReservationNotFoundError } from '@/server/domain/errors';
import { describeForLog } from '@/server/http/problem-details';
import {
    getReservationByToken,
    type ReservationDetails,
} from '@/server/services/reservations/get-reservation';

export const metadata: Metadata = {
    title: 'Vaše rezervace · BakeryOS',
    robots: { index: false, follow: false },
    // The URL carries the management token, a bearer credential.
    referrer: 'no-referrer',
};

/** The page's heading and the cancellation card's text for the reservation's current state. */
const describeReservation = (
    details: ReservationDetails,
    now: Date,
): { heading: string; cancellationNote: string[] } => {
    const cutoff = formatPragueDateTimeWithPreposition(details.cancellationCutoff);
    switch (details.status) {
        case 'confirmed':
            return {
                heading: 'Vaše rezervace',
                cancellationNote: !details.canCancel
                    ? [
                          now >= details.cancellationDeadline
                              ? 'Den vyzvednutí už skončil, rezervaci nelze zrušit.'
                              : 'Rezervaci už nelze zrušit.',
                      ]
                    : details.cancellationRetainsProduction
                      ? [
                            'Pečivo pro vás už máme naplánované. Pokud nemůžete přijít, rezervaci prosím zrušte, ať s vámi nepočítáme.',
                        ]
                      : [
                            `Rezervaci můžete zrušit až do konce dne vyzvednutí. Pokud je to možné, zrušte ji prosím ještě před uzávěrkou (${cutoff}), abychom zbytečně nepekli pečivo navíc.`,
                            'Pokud chcete rezervaci změnit, zrušte ji a vytvořte novou.',
                        ],
            };
        case 'cancelled':
            return {
                heading: 'Rezervace je zrušená',
                cancellationNote: ['S vyzvednutím nepočítáme. Můžete si vytvořit novou rezervaci.'],
            };
        case 'picked_up':
            return {
                heading: 'Rezervace byla vyzvednuta',
                cancellationNote: ['Rezervace je uzavřená.'],
            };
        case 'no_show':
            return {
                heading: 'Rezervace nebyla vyzvednuta',
                cancellationNote: ['Rezervace je uzavřená.'],
            };
    }
};

const NewReservationLink = ({ label }: { label: string }) => (
    <Link href="/" className={`inline-block ${SECONDARY_BUTTON_CLASSES}`}>
        {label}
    </Link>
);

const ManagedReservation = async ({
    params,
}: {
    params: PageProps<'/reservations/manage/[token]'>['params'];
}) => {
    // Cancellation eligibility depends on the current time, so the page is never cached.
    await connection();
    const { token } = await params;
    // One instant for the eligibility check, the text and the refresh timer.
    const now = new Date();
    let details: ReservationDetails;
    try {
        details = await getReservationByToken(token, { now });
    } catch (error) {
        unstable_rethrow(error);
        if (error instanceof ReservationNotFoundError) {
            return (
                <div className="flex flex-col items-start gap-4">
                    <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                        Rezervace nenalezena
                    </h1>
                    <Notice>
                        Odkaz je neplatný nebo neúplný. Zkontrolujte, že jste ho zkopírovali celý.
                    </Notice>
                    <NewReservationLink label="Vytvořit rezervaci" />
                </div>
            );
        }
        // Query errors carry the token hash as a parameter. Next logs the thrown error with its
        // digest, so the sanitized cause appears in the same log entry.
        throw new Error('The reservation could not be loaded.', { cause: describeForLog(error) });
    }
    const { heading, cancellationNote } = describeReservation(details, now);
    return (
        <section aria-labelledby="reservation-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h1
                    id="reservation-heading"
                    className="text-3xl font-semibold tracking-tight text-amber-950"
                >
                    {heading}
                </h1>
                <p className="text-stone-600">
                    Číslo rezervace{' '}
                    <strong className="font-semibold text-amber-950">
                        {details.reservationNumber}
                    </strong>
                    , {details.customerName}, vyzvednutí {formatLongDate(details.pickupDate)}.
                    {details.status === 'confirmed' && ' Zaplatíte až při vyzvednutí.'}
                </p>
            </div>
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                <ReservationItems items={details.items} totalPrice={details.totalPrice} />
                <ReservationCancellation
                    token={token}
                    canCancel={details.canCancel}
                    refreshInMs={
                        details.cancellationChangesAt &&
                        details.cancellationChangesAt.getTime() - now.getTime()
                    }
                >
                    {cancellationNote.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                    ))}
                </ReservationCancellation>
            </div>
            <div>
                <NewReservationLink label="Vytvořit další rezervaci" />
            </div>
        </section>
    );
};

/** Opened from the management link; stays usable after a refresh because it reads the server. */
const ManageReservationPage = ({ params }: PageProps<'/reservations/manage/[token]'>) => (
    <Suspense fallback={<Notice>Načítáme rezervaci…</Notice>}>
        <ManagedReservation params={params} />
    </Suspense>
);

export default ManageReservationPage;
