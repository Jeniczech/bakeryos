import { asc, desc, eq } from 'drizzle-orm';
import { uuidSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { products } from '@/server/db/schema';

export type AdminProduct = {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number; // haléře
    active: boolean;
    defaultCapacity: number;
    defaultWalkInQuantity: number;
};

export const adminProductColumns = {
    id: products.id,
    name: products.name,
    description: products.description,
    imageUrl: products.imageUrl,
    price: products.price,
    active: products.active,
    defaultCapacity: products.defaultCapacity,
    defaultWalkInQuantity: products.defaultWalkInQuantity,
};

/** Every product, inactive ones included: active first, then by name. */
export const listProducts = async (): Promise<AdminProduct[]> =>
    getDb()
        .select(adminProductColumns)
        .from(products)
        .orderBy(desc(products.active), asc(products.name), asc(products.id));

/** `null` for a malformed or unknown ID. */
export const getProduct = async (productId: string): Promise<AdminProduct | null> => {
    const parsed = uuidSchema.safeParse(productId);
    if (!parsed.success) {
        return null;
    }
    const [product] = await getDb()
        .select(adminProductColumns)
        .from(products)
        .where(eq(products.id, parsed.data));
    return product ?? null;
};
