import Link from 'next/link';
import { Suspense } from 'react';
import { DateNavigation } from '@/components/admin/date-navigation';
import { ReservationList } from '@/components/admin/reservation-list';
import { PRIMARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { getPragueDate, isValidCalendarDate } from '@/lib/date-time/prague';
import { formatLongDate } from '@/lib/formatting/dates';
import { requireAdmin } from '@/server/auth/require-admin';
import { getReservationCutoff } from '@/server/domain/reservation-rules';
import { getPickupDates } from '@/server/services/eligibility';
import { getDailyReservations } from '@/server/services/reservations/get-daily-reservations';

type SearchParams = PageProps<'/admin/reservations'>['searchParams'];

const PATH = '/admin/reservations';

const ReservationsContent = async ({ searchParams }: { searchParams: SearchParams }) => {
    await requireAdmin();
    const now = new Date();
    const today = getPragueDate(now);
    const { date: requestedDate } = await searchParams;
    const date =
        typeof requestedDate === 'string' && isValidCalendarDate(requestedDate)
            ? requestedDate
            : today;
    const [reservations, pickupDates] = await Promise.all([
        getDailyReservations(date, { now }),
        getPickupDates(now),
    ]);
    const canBook = pickupDates.some(
        (option) => option.date === date && option.unavailableReason === null,
    );

    return (
        <div className="flex flex-col gap-4">
            {/* Keyed so the date input shows the new date after link navigation. */}
            <DateNavigation
                key={date}
                path={PATH}
                date={date}
                today={today}
                label="Datum vyzvednutí"
            />
            <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-amber-950">
                    {formatLongDate(date)}
                    {date === today && ' (dnes)'}
                </h2>
                {canBook && (
                    <Link
                        href={`/admin/reservations/new?date=${date}`}
                        className={PRIMARY_BUTTON_CLASSES}
                    >
                        Nová telefonická rezervace
                    </Link>
                )}
            </div>
            {date < today && (
                <Notice>
                    Datum vyzvednutí už proběhlo: rezervace lze ještě označit jako vyzvednuté nebo
                    nevyzvednuté, ale ne zrušit.
                </Notice>
            )}
            {reservations.length === 0 ? (
                <Notice>Na tento den nejsou žádné rezervace.</Notice>
            ) : (
                <ReservationList
                    reservations={reservations}
                    cancellationCutoff={getReservationCutoff(date).toISOString()}
                />
            )}
        </div>
    );
};

const ReservationsPage = ({ searchParams }: PageProps<'/admin/reservations'>) => (
    <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Rezervace</h1>
        <Suspense fallback={<Notice>Načítáme rezervace…</Notice>}>
            <ReservationsContent searchParams={searchParams} />
        </Suspense>
    </section>
);

export default ReservationsPage;
