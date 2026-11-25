import { productInputSchema, type ProductInput } from '@/lib/validation/product';
import { getDb } from '@/server/db/client';
import { products } from '@/server/db/schema';
import { InvalidRequestError, toValidationIssues } from '@/server/domain/errors';
import { adminProductColumns, type AdminProduct } from './admin-products';

/**
 * Adds a product; admins are authorized by the caller. A new product has no weekday rows, so it
 * is offered on every open day. Its defaults apply to dates without a daily plan yet.
 */
export const createProduct = async (input: ProductInput): Promise<AdminProduct> => {
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new InvalidRequestError(toValidationIssues(parsed.error));
    }
    const [product] = await getDb()
        .insert(products)
        .values(parsed.data)
        .returning(adminProductColumns);
    return product;
};
