import Link from 'next/link';
import { formatPrice } from '@/lib/formatting/money';
import type { AdminProduct } from '@/server/services/products/admin-products';

export const ProductList = ({ products }: { products: readonly AdminProduct[] }) => (
    <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
            <thead className="border-b border-amber-200 bg-amber-50 text-stone-600">
                <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Produkt
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Cena
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Výchozí kapacita
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Pultový prodej
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                        Stav
                    </th>
                    <th scope="col" className="px-4 py-3">
                        <span className="sr-only">Akce</span>
                    </th>
                </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
                {products.map((product) => (
                    <tr key={product.id} className={product.active ? undefined : 'text-stone-500'}>
                        <td className="px-4 py-3 font-medium">{product.name}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                            {formatPrice(product.price)}
                        </td>
                        <td className="px-4 py-3 text-right">{product.defaultCapacity}</td>
                        <td className="px-4 py-3 text-right">{product.defaultWalkInQuantity}</td>
                        <td className="px-4 py-3">{product.active ? 'Aktivní' : 'Neaktivní'}</td>
                        <td className="px-4 py-3 text-right">
                            <Link
                                href={`/admin/products/${product.id}`}
                                className="font-medium text-amber-900 underline"
                            >
                                Upravit<span className="sr-only"> {product.name}</span>
                            </Link>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
