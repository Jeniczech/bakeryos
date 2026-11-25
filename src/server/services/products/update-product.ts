import { eq } from 'drizzle-orm';
import { productInputSchema, type ProductInput } from '@/lib/validation/product';
import { uuidSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { products } from '@/server/db/schema';
import {
    InvalidRequestError,
    ProductNotFoundError,
    toValidationIssues,
} from '@/server/domain/errors';
import { adminProductColumns, type AdminProduct } from './admin-products';

/**
 * Replaces a product's details; admins are authorized by the caller. `active: false` deactivates
 * it, which blocks new reservations (`createReservation` re-checks activity after locking) and
 * keeps it out of the catalog. Existing reservations are unaffected: their items carry name and
 * price snapshots. Existing daily plans keep their capacity; new defaults apply only to dates
 * planned afterwards.
 */
export const updateProduct = async (
    productId: string,
    input: ProductInput,
): Promise<AdminProduct> => {
    const id = uuidSchema.safeParse(productId);
    if (!id.success) {
        throw new ProductNotFoundError(productId);
    }
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(toValidationIssues(parsed.error));
    }
    const [product] = await getDb()
        .update(products)
        .set(parsed.data)
        .where(eq(products.id, id.data))
        .returning(adminProductColumns);
    if (!product) {
        throw new ProductNotFoundError(productId);
    }
    return product;
};
