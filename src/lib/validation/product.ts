import { z } from 'zod';

export const PRODUCT_NAME_MAX_LENGTH = 100;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;

/** PostgreSQL `integer` upper bound; larger values would fail in the database instead of here. */
const MAX_INTEGER = 2_147_483_647;

const quantitySchema = z.int().min(0).max(MAX_INTEGER);

/** Blank optional text is stored as `null`. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullish()
        .transform((value) => (value ? value : null));

const productFieldsSchema = z.object({
    name: z.string().trim().min(1).max(PRODUCT_NAME_MAX_LENGTH),
    description: optionalText(PRODUCT_DESCRIPTION_MAX_LENGTH),
    price: quantitySchema, // haléře
    defaultCapacity: quantitySchema,
    defaultWalkInQuantity: quantitySchema,
    active: z.boolean(),
});

const defaultQuantitiesSchema = productFieldsSchema.pick({
    defaultCapacity: true,
    defaultWalkInQuantity: true,
});

export const productInputSchema = productFieldsSchema.refine(
    (product) => product.defaultWalkInQuantity <= product.defaultCapacity,
    {
        path: ['defaultWalkInQuantity'],
        message: 'Walk-in quantity cannot exceed capacity.',
        // Also reported while unrelated fields are invalid, so the form shows every problem.
        when: (payload) => defaultQuantitiesSchema.safeParse(payload.value).success,
    },
);

export type ProductInput = z.input<typeof productInputSchema>;

const CROWNS_PATTERN = /^(\d{1,8})(?:[.,](\d{1,2}))?$/;

/**
 * A price typed in Czech crowns, e.g. "45", "45,5" or "45.50", in haléře; `null` if it is not a
 * non-negative amount with at most two decimals. Parsed as text to avoid float rounding.
 */
export const parseCrownsToHalere = (value: string): number | null => {
    const match = CROWNS_PATTERN.exec(value.replace(/\s/g, ''));
    if (!match) {
        return null;
    }
    const [, crowns, fraction = ''] = match;
    return Number(crowns) * 100 + Number(fraction.padEnd(2, '0'));
};
