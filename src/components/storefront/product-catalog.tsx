import Image from 'next/image';
import { Notice } from '@/components/ui/notice';
import type { AvailableProduct } from '@/server/services/products/get-available-products';

export const ProductCatalog = ({
    longDate,
    cutoff,
    products,
}: {
    longDate: string;
    cutoff: string;
    products: readonly AvailableProduct[];
}) => (
    <section aria-labelledby="catalog-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
            <h2 id="catalog-heading" className="text-lg font-semibold text-amber-950">
                Nabídka na vyzvednutí: {longDate}
            </h2>
            <p className="text-sm text-stone-600">Uzávěrka objednávek: {cutoff}</p>
        </div>
        {products.length === 0 ? (
            <Notice>Na tento den není nic k rezervaci. Zkuste prosím jiný den.</Notice>
        ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
                {products.map((product) => (
                    <li
                        key={product.id}
                        className="flex flex-col overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm"
                    >
                        {product.imageUrl && (
                            <div className="relative aspect-[4/3] bg-amber-100">
                                {/* Admin-entered URLs can point anywhere, so skip the optimizer's host allowlist. */}
                                <Image
                                    src={product.imageUrl}
                                    alt=""
                                    fill
                                    unoptimized
                                    sizes="(min-width: 640px) 50vw, 100vw"
                                    className="object-cover"
                                />
                            </div>
                        )}
                        <div className="flex flex-col gap-1 p-4">
                            <h3 className="font-semibold text-amber-950">{product.name}</h3>
                            {product.description && (
                                <p className="text-sm text-stone-600">{product.description}</p>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        )}
    </section>
);
