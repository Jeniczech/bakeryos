import Link from 'next/link';
import { Suspense } from 'react';
import { ProductList } from '@/components/admin/product-list';
import { PRIMARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { requireAdmin } from '@/server/auth/require-admin';
import { listProducts } from '@/server/services/products/admin-products';

const ProductsContent = async () => {
    await requireAdmin();
    const products = await listProducts();
    if (products.length === 0) {
        return <Notice>Zatím nejsou žádné produkty.</Notice>;
    }
    return <ProductList products={products} />;
};

const ProductsPage = () => (
    <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Produkty</h1>
            <Link href="/admin/products/new" className={PRIMARY_BUTTON_CLASSES}>
                Nový produkt
            </Link>
        </div>
        <Suspense fallback={<Notice>Načítáme produkty…</Notice>}>
            <ProductsContent />
        </Suspense>
    </section>
);

export default ProductsPage;
