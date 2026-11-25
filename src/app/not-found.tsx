import Link from 'next/link';
import { StorefrontFrame } from '@/components/storefront/storefront-frame';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';

/** Unknown URLs; rendered in the root layout, so it brings the storefront frame itself. */
const NotFound = () => (
    <StorefrontFrame>
        <section className="flex flex-col items-start gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                Stránka nenalezena
            </h1>
            <p className="text-stone-600">Tato stránka neexistuje. Zkontrolujte prosím adresu.</p>
            <Link href="/" className={SECONDARY_BUTTON_CLASSES}>
                Zpět na úvod
            </Link>
        </section>
    </StorefrontFrame>
);

export default NotFound;
