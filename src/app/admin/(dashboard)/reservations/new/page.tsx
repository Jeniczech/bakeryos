import Link from 'next/link';
import { Suspense } from 'react';
import {
    DateTransitionContent,
    DateTransitionProvider,
    DateTransitionStatus,
    TransitionLink,
} from '@/components/admin/date-transition';
import { ManualReservationForm } from '@/components/admin/manual-reservation-form';
import { ADMIN_PICKUP_DATE_MESSAGES } from '@/components/admin/pickup-date-messages';
import { SECONDARY_BUTTON_CLASSES, SELECTED_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { LoadingNotice } from '@/components/ui/loading-notice';
import { Notice } from '@/components/ui/notice';
import { isValidCalendarDate, type CalendarDate } from '@/lib/date-time/prague';
import { formatLongDateWithPreposition, formatShortDate } from '@/lib/formatting/dates';
import { requireAdmin } from '@/server/auth/require-admin';
import { PickupDateUnavailableError } from '@/server/domain/errors';
import type { PickupDateOption } from '@/server/domain/reservation-rules';
import { getPickupDates } from '@/server/services/eligibility';
import { getAvailableProducts } from '@/server/services/products/get-available-products';

type SearchParams = PageProps<'/admin/reservations/new'>['searchParams'];

const PATH = '/admin/reservations/new';

const DatePicker = ({
    dates,
    selected,
}: {
    dates: readonly PickupDateOption[];
    selected: CalendarDate;
}) => (
    <nav aria-label="Datum vyzvednutí" className="flex flex-wrap items-center gap-2">
        {dates.map(({ date, unavailableReason }) => {
            const { weekday, dayMonth } = formatShortDate(date);
            const label = `${weekday} ${dayMonth}`;
            if (unavailableReason) {
                return (
                    <span
                        key={date}
                        title={ADMIN_PICKUP_DATE_MESSAGES[unavailableReason]}
                        className="rounded-lg border border-stone-200 px-4 py-2 text-stone-400 line-through"
                    >
                        {label}
                    </span>
                );
            }
            return (
                <TransitionLink
                    key={date}
                    href={`${PATH}?date=${date}`}
                    current={date === selected}
                    className={
                        date === selected ? SELECTED_BUTTON_CLASSES : SECONDARY_BUTTON_CLASSES
                    }
                >
                    {label}
                </TransitionLink>
            );
        })}
        <DateTransitionStatus />
    </nav>
);

/** The admin catalog for the date, or why the date cannot be booked. */
const loadCatalog = async (date: CalendarDate, now: Date) => {
    try {
        return await getAvailableProducts(date, { now });
    } catch (error) {
        if (error instanceof PickupDateUnavailableError) {
            return error.code;
        }
        throw error;
    }
};

const ReservationFormSection = async ({ date, now }: { date: CalendarDate; now: Date }) => {
    const catalog = await loadCatalog(date, now);
    if (typeof catalog === 'string') {
        return <Notice tone="warning">{ADMIN_PICKUP_DATE_MESSAGES[catalog]}</Notice>;
    }
    if (catalog.products.length === 0) {
        return <Notice>Na tento den nejsou v nabídce žádné produkty.</Notice>;
    }
    // Keyed so switching dates starts a fresh form with a fresh idempotency key.
    return <ManualReservationForm key={date} pickupDate={date} products={catalog.products} />;
};

const NewReservationContent = async ({ searchParams }: { searchParams: SearchParams }) => {
    await requireAdmin();
    const now = new Date();
    const { date: requestedDate } = await searchParams;
    const dates = await getPickupDates(now);
    const firstOpenDate = dates.find((option) => !option.unavailableReason)?.date;
    const date =
        typeof requestedDate === 'string' && isValidCalendarDate(requestedDate)
            ? requestedDate
            : (firstOpenDate ?? dates[0].date);

    return (
        <DateTransitionProvider>
            <div className="flex flex-col gap-4">
                <DatePicker dates={dates} selected={date} />
                <DateTransitionContent>
                    <h2 className="text-xl font-semibold text-amber-950">
                        Vyzvednutí {formatLongDateWithPreposition(date)}
                    </h2>
                    <ReservationFormSection date={date} now={now} />
                </DateTransitionContent>
            </div>
        </DateTransitionProvider>
    );
};

const NewReservationPage = ({ searchParams }: PageProps<'/admin/reservations/new'>) => (
    <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                Telefonická rezervace
            </h1>
            <Link href="/admin/reservations" className={SECONDARY_BUTTON_CLASSES}>
                ← Zpět na rezervace
            </Link>
        </div>
        <Suspense fallback={<LoadingNotice>Načítáme nabídku…</LoadingNotice>}>
            <NewReservationContent searchParams={searchParams} />
        </Suspense>
    </section>
);

export default NewReservationPage;
