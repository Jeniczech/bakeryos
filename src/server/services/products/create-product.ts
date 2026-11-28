import { productInputSchema, type ProductInput } from '@/lib/validation/product';
import { getDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { products } from '@/server/db/schema';
import {
    InvalidRequestError,
    ProductNameTakenError,
    toValidationIssues,
} from '@/server/domain/errors';
import { adminProductColumns, PRODUCT_NAME_CONSTRAINT, type AdminProduct } from './admin-products';

/**
 * Adds a product; admins are authorized by the caller. A new product has no weekday rows, so it
 * is offered on every open day. Its defaults apply to dates without a daily plan yet. Names are
 * unique case-insensitively, inactive products included: reactivate a product rather than
 * recreate it.
 */
export const createProduct = async (input: ProductInput): Promise<AdminProduct> => {
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(toValidationIssues(parsed.error));
    }
    try {
        const [product] = await getDb()
            .insert(products)
            .values(parsed.data)
            .returning(adminProductColumns);
        return product;
    } catch (error) {
        if (isUniqueViolation(error, PRODUCT_NAME_CONSTRAINT)) {
            throw new ProductNameTakenError(parsed.data.name);
        }
        throw error;
    }
};
