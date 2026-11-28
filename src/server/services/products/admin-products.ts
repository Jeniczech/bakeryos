import { asc, desc, eq, sql } from 'drizzle-orm';
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
    /** Changes on every save; an editor sends it back so a stale form cannot overwrite. */
    version: string;
};

/**
 * `updated_at` in whole microseconds, as text: exact, unlike a JavaScript `Date`, which drops
 * the microseconds PostgreSQL stores.
 */
/** The case-insensitive unique index on product names (`products_name_unique`). */
export const PRODUCT_NAME_CONSTRAINT = 'products_name_unique';

export const productVersion = sql<string>`(extract(epoch from ${products.updatedAt}) * 1000000)::bigint::text`;

export const adminProductColumns = {
    id: products.id,
    name: products.name,
    description: products.description,
    imageUrl: products.imageUrl,
    price: products.price,
    active: products.active,
    defaultCapacity: products.defaultCapacity,
    defaultWalkInQuantity: products.defaultWalkInQuantity,
    version: productVersion,
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
