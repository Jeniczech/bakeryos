import Link from 'next/link';
import { Suspense } from 'react';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { requireAdmin } from '@/server/auth/require-admin';
import { logOut } from './actions';

/** Redirects a signed-out visitor to the login page. A convenience only: pages guard themselves. */
const AdminAccount = async () => {
    const admin = await requireAdmin();
    return (
        <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-stone-600 sm:inline">{admin.email}</span>
            <form action={logOut}>
                <button type="submit" className={SECONDARY_BUTTON_CLASSES}>
                    Odhlásit se
                </button>
            </form>
        </div>
    );
};

const DashboardLayout = ({ children }: LayoutProps<'/admin'>) => (
    <>
        <header className="border-b border-amber-200 bg-amber-100/60">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
                <nav aria-label="Administrace" className="flex items-center gap-6">
                    <Link
                        href="/admin/reservations"
                        className="text-xl font-semibold tracking-tight text-amber-900"
                    >
                        BakeryOS
                    </Link>
                    <Link href="/admin/reservations" className="font-medium text-amber-950">
                        Rezervace
                    </Link>
                    <Link href="/admin/products" className="font-medium text-amber-950">
                        Produkty
                    </Link>
                </nav>
                <Suspense fallback={null}>
                    <AdminAccount />
                </Suspense>
            </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
);

export default DashboardLayout;
