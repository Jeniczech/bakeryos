import Link from 'next/link';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';

/** Unknown URLs; rendered in the root layout, outside the storefront's header. */
const NotFound = () => (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-amber-50 px-4 py-16 text-center text-stone-900">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Stránka nenalezena</h1>
        <p className="text-stone-600">Tato stránka neexistuje. Zkontrolujte prosím adresu.</p>
        <Link href="/" className={SECONDARY_BUTTON_CLASSES}>
            Zpět na úvod
        </Link>
    </main>
);

export default NotFound;
