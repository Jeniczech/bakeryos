import { Suspense } from 'react';
import { ProductForm } from '@/components/admin/product-form';
import { LoadingNotice } from '@/components/ui/loading-notice';
import { requireAdmin } from '@/server/auth/require-admin';

/** Guarded like every admin page, although the form itself shows no data. */
const NewProductContent = async () => {
    await requireAdmin();
    return <ProductForm />;
};

const NewProductPage = () => (
    <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Nový produkt</h1>
        <Suspense fallback={<LoadingNotice>Načítáme formulář…</LoadingNotice>}>
            <NewProductContent />
        </Suspense>
    </section>
);

export default NewProductPage;
