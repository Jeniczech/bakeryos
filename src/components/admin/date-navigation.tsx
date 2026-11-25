import Form from 'next/form';
import Link from 'next/link';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { addDays } from '@/lib/date-time/prague';

/** Previous/today/next links and a date picker, each loading `path?date=YYYY-MM-DD`. */
export const DateNavigation = ({
    path,
    date,
    today,
    label,
}: {
    path: string;
    date: string;
    today: string;
    /** Accessible name of the date picker. */
    label: string;
}) => {
    const dateHref = (target: string) => `${path}?date=${target}`;
    const inputId = `${path.replaceAll('/', '-').slice(1)}-date`;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Link href={dateHref(addDays(date, -1))} className={SECONDARY_BUTTON_CLASSES}>
                ← Předchozí den
            </Link>
            <Link href={dateHref(today)} className={SECONDARY_BUTTON_CLASSES}>
                Dnes
            </Link>
            <Link href={dateHref(addDays(date, 1))} className={SECONDARY_BUTTON_CLASSES}>
                Další den →
            </Link>
            <Form action={path} className="flex items-center gap-2">
                <label htmlFor={inputId} className="sr-only">
                    {label}
                </label>
                <input
                    id={inputId}
                    type="date"
                    name="date"
                    defaultValue={date}
                    required
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2"
                />
                <button type="submit" className={SECONDARY_BUTTON_CLASSES}>
                    Zobrazit
                </button>
            </Form>
        </div>
    );
};
