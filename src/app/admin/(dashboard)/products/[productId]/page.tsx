import Link from 'next/link';
import { Suspense } from 'react';
import { ProductForm } from '@/components/admin/product-form';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { LoadingNotice } from '@/components/ui/loading-notice';
import { Notice } from '@/components/ui/notice';
import { formatCrownsInput } from '@/lib/formatting/money';
import { requireAdmin } from '@/server/auth/require-admin';
import { getProduct } from '@/server/services/products/admin-products';

type Params = PageProps<'/admin/products/[productId]'>['params'];

const EditProductContent = async ({ params }: { params: Params }) => {
    await requireAdmin();
    const { productId } = await params;
    const product = await getProduct(productId);
    if (!product) {
        return <Notice tone="warning">Produkt nebyl nalezen.</Notice>;
    }
    return (
        <ProductForm
            product={{
                id: product.id,
                version: product.version,
                values: {
                    name: product.name,
                    description: product.description ?? '',
                    imageUrl: product.imageUrl ?? '',
                    price: formatCrownsInput(product.price),
                    defaultCapacity: String(product.defaultCapacity),
                    defaultWalkInQuantity: String(product.defaultWalkInQuantity),
                    active: product.active,
                },
            }}
        />
    );
};

const EditProductPage = ({ params }: PageProps<'/admin/products/[productId]'>) => (
    <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-amber-950">
                Úprava produktu
            </h1>
            <Link href="/admin/products" className={SECONDARY_BUTTON_CLASSES}>
                ← Zpět na produkty
            </Link>
        </div>
        <Suspense fallback={<LoadingNotice>Načítáme produkt…</LoadingNotice>}>
            <EditProductContent params={params} />
        </Suspense>
    </section>
);

export default EditProductPage;
