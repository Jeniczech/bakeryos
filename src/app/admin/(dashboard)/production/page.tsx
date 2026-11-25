import { Suspense } from 'react';
import { DateNavigation } from '@/components/admin/date-navigation';
import { DateTransitionContent, DateTransitionProvider } from '@/components/admin/date-transition';
import { ProductionTable } from '@/components/admin/production-table';
import { Notice } from '@/components/ui/notice';
import { getPragueDate, isValidCalendarDate } from '@/lib/date-time/prague';
import { formatLongDate } from '@/lib/formatting/dates';
import { requireAdmin } from '@/server/auth/require-admin';
import {
    getDailyProduction,
    type ProductionDateLock,
} from '@/server/services/production/get-daily-production';

type SearchParams = PageProps<'/admin/production'>['searchParams'];

const PATH = '/admin/production';

const DATE_LOCK_MESSAGES: Record<ProductionDateLock, string> = {
    BAKERY_CLOSED: 'Pekárna má v tento den zavřeno.',
    PAST_DATE: 'Den už proběhl: plán slouží jen pro přehled a nelze ho měnit.',
    BEYOND_PLANNING_WINDOW: 'Plán lze upravovat nejvýše 7 dní dopředu.',
};

const ProductionContent = async ({ searchParams }: { searchParams: SearchParams }) => {
    await requireAdmin();
    const now = new Date();
    const today = getPragueDate(now);
    const { date: requestedDate } = await searchParams;
    const date =
        typeof requestedDate === 'string' && isValidCalendarDate(requestedDate)
            ? requestedDate
            : today;
    const production = await getDailyProduction(date, { now });

    return (
        <DateTransitionProvider>
            <div className="flex flex-col gap-4">
                {/* Keyed so the date input shows the new date after link navigation. */}
                <DateNavigation
                    key={`navigation-${date}`}
                    path={PATH}
                    date={date}
                    today={today}
                    label="Datum výroby"
                />
                <DateTransitionContent>
                    <h2 className="text-xl font-semibold text-amber-950">
                        {formatLongDate(date)}
                        {date === today && ' (dnes)'}
                    </h2>
                    {production.dateLock && (
                        <Notice>{DATE_LOCK_MESSAGES[production.dateLock]}</Notice>
                    )}
                    {production.rows.length === 0 ? (
                        <Notice>Na tento den se nic nevyrábí.</Notice>
                    ) : (
                        // Keyed by date so the row forms start fresh on another day.
                        <ProductionTable key={`table-${date}`} date={date} rows={production.rows} />
                    )}
                    <p className="text-sm text-stone-600">
                        Upéct = rezervováno + zrušeno po uzávěrce + pultový prodej. Rezervace
                        zrušené po uzávěrce zůstávají ve výrobě. Kapacitu nelze snížit pod pultový
                        prodej a už rezervované kusy.
                    </p>
                </DateTransitionContent>
            </div>
        </DateTransitionProvider>
    );
};

const ProductionPage = ({ searchParams }: PageProps<'/admin/production'>) => (
    <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Výroba</h1>
        <Suspense fallback={<Notice>Načítáme výrobu…</Notice>}>
            <ProductionContent searchParams={searchParams} />
        </Suspense>
    </section>
);

export default ProductionPage;
