import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CancelReservationButton } from '@/components/storefront/cancel-reservation-button';
import { ReservationItems } from '@/components/storefront/reservation-items';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { formatLongDate, formatPragueDateTime } from '@/lib/formatting/dates';
import { ReservationNotFoundError } from '@/server/domain/errors';
import type { ReservationStatus } from '@/server/domain/reservation-rules';
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

const HEADINGS: Record<ReservationStatus, string> = {
    confirmed: 'Vaše rezervace',
    cancelled: 'Rezervace je zrušená',
    picked_up: 'Rezervace byla vyzvednuta',
    no_show: 'Rezervace nebyla vyzvednuta',
};

const NewReservationLink = ({ label }: { label: string }) => (
    <Link href="/" className={`inline-block ${SECONDARY_BUTTON_CLASSES}`}>
        {label}
    </Link>
);

const CancellationSection = ({
    details,
    token,
}: {
    details: ReservationDetails;
    token: string;
}) => {
    const cutoff = formatPragueDateTime(details.cancellationCutoff);
    let content: React.ReactNode;
    if (details.canCancel) {
        content = (
            <>
                <p className="text-sm text-stone-600">
                    Rezervaci můžete zrušit do {cutoff}. Upravit ji nelze, místo toho ji zrušte a
                    vytvořte novou.
                </p>
                <CancelReservationButton token={token} />
            </>
        );
    } else if (details.status === 'confirmed') {
        content = (
            <p className="text-sm text-stone-600">
                Online zrušení bylo možné do {cutoff}. Pokud nemůžete přijít, dejte prosím vědět
                pekárně.
            </p>
        );
    } else if (details.status === 'cancelled') {
        content = <p className="text-sm text-stone-600">Rezervace byla zrušena.</p>;
    } else {
        content = <p className="text-sm text-stone-600">Rezervaci už nelze měnit.</p>;
    }
    return (
        <section
            aria-labelledby="cancellation-heading"
            className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
        >
            <h2 id="cancellation-heading" className="text-lg font-semibold text-amber-950">
                Zrušení
            </h2>
            {content}
        </section>
    );
};

const ManagedReservation = async ({
    params,
}: {
    params: PageProps<'/reservations/manage/[token]'>['params'];
}) => {
    // Cancellation eligibility depends on the current time, so the page is never cached.
    await connection();
    const { token } = await params;
    let details: ReservationDetails;
    try {
        details = await getReservationByToken(token);
    } catch (error) {
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
        throw error;
    }
    return (
        <section aria-labelledby="reservation-heading" className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h1
                    id="reservation-heading"
                    className="text-3xl font-semibold tracking-tight text-amber-950"
                >
                    {HEADINGS[details.status]}
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
                <CancellationSection details={details} token={token} />
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
