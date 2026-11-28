import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { productInputSchema, type ProductInput } from '@/lib/validation/product';
import { uuidSchema } from '@/lib/validation/reservation';
import { getDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { products } from '@/server/db/schema';
import {
    InvalidRequestError,
    ProductChangedError,
    ProductNameTakenError,
    ProductNotFoundError,
    toValidationIssues,
} from '@/server/domain/errors';
import {
    adminProductColumns,
    PRODUCT_NAME_CONSTRAINT,
    productVersion,
    type AdminProduct,
} from './admin-products';

const versionSchema = z.string().regex(/^\d{1,20}$/);

/**
 * Replaces a product's details; admins are authorized by the caller. `expectedVersion` is the
 * `version` the editor loaded: if the product was saved since, nothing is written and
 * `ProductChangedError` is thrown, so a stale form never undoes a newer change.
 *
 * `active: false` deactivates the product, which blocks new reservations (`createReservation`
 * re-checks activity after locking) and keeps it out of the catalog. Existing reservations are
 * unaffected: their items carry name and price snapshots. A name another product has, compared
 * case-insensitively, throws `ProductNameTakenError`. Existing daily plans keep their
 * capacity; new defaults apply only to dates planned afterwards.
 */
export const updateProduct = async (
    productId: string,
    input: ProductInput,
    expectedVersion: string,
): Promise<AdminProduct> => {
    const id = uuidSchema.safeParse(productId);
    if (!id.success) {
        throw new ProductNotFoundError(productId);
    }
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(toValidationIssues(parsed.error));
    }
    const version = versionSchema.safeParse(expectedVersion);
    if (!version.success) {
        throw new InvalidRequestError([{ path: 'version', message: 'Invalid product version.' }]);
    }
    const [product] = await getDb()
        .update(products)
        .set(parsed.data)
        .where(and(eq(products.id, id.data), sql`${productVersion} = ${version.data}`))
        .returning(adminProductColumns)
        .catch((error: unknown) => {
            throw isUniqueViolation(error, PRODUCT_NAME_CONSTRAINT)
                ? new ProductNameTakenError(parsed.data.name)
                : error;
        });
    if (product) {
        return product;
    }
    const [existing] = await getDb()
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, id.data));
    throw existing ? new ProductChangedError(productId) : new ProductNotFoundError(productId);
};
