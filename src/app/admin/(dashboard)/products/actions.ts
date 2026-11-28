'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCrownsToHalere, type ProductInput } from '@/lib/validation/product';
import { requireAdmin } from '@/server/auth/require-admin';
import {
    InvalidRequestError,
    ProductChangedError,
    ProductNameTakenError,
    ProductNotFoundError,
} from '@/server/domain/errors';
import { createProduct } from '@/server/services/products/create-product';
import { updateProduct } from '@/server/services/products/update-product';

export type ProductField =
    'name' | 'description' | 'imageUrl' | 'price' | 'defaultCapacity' | 'defaultWalkInQuantity';

/** The form as submitted, so a rejected form shows what was entered. */
export type ProductFormValues = Record<ProductField, string> & { active: boolean };

export type ProductFormState = {
    error: 'INVALID_REQUEST' | 'NAME_TAKEN' | 'NOT_FOUND' | 'CHANGED' | 'UNAVAILABLE' | null;
    fields: ProductField[];
    values: ProductFormValues;
};

const PRODUCT_FIELDS: readonly ProductField[] = [
    'name',
    'description',
    'imageUrl',
    'price',
    'defaultCapacity',
    'defaultWalkInQuantity',
];

const PRODUCTS_PATH = '/admin/products';

const readValues = (formData: FormData): ProductFormValues => {
    const text = (field: ProductField) => {
        const value = formData.get(field);
        return typeof value === 'string' ? value : '';
    };
    return {
        name: text('name'),
        description: text('description'),
        imageUrl: text('imageUrl'),
        price: text('price'),
        defaultCapacity: text('defaultCapacity'),
        defaultWalkInQuantity: text('defaultWalkInQuantity'),
        active: formData.get('active') === 'on',
    };
};

/** A whole number typed in the form, or `NaN`, which the service rejects for that field. */
const parseWholeNumber = (value: string): number =>
    /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;

const toProductInput = (values: ProductFormValues): ProductInput => ({
    name: values.name,
    description: values.description,
    imageUrl: values.imageUrl,
    price: parseCrownsToHalere(values.price) ?? Number.NaN,
    defaultCapacity: parseWholeNumber(values.defaultCapacity),
    defaultWalkInQuantity: parseWholeNumber(values.defaultWalkInQuantity),
    active: values.active,
});

const toFailure = (error: unknown, values: ProductFormValues): ProductFormState => {
    if (error instanceof InvalidRequestError) {
        const fields = PRODUCT_FIELDS.filter((field) =>
            error.issues.some((issue) => issue.path === field),
        );
        return { error: 'INVALID_REQUEST', fields, values };
    }
    if (error instanceof ProductNameTakenError) {
        return { error: 'NAME_TAKEN', fields: ['name'], values };
    }
    if (error instanceof ProductNotFoundError) {
        return { error: 'NOT_FOUND', fields: [], values };
    }
    if (error instanceof ProductChangedError) {
        return { error: 'CHANGED', fields: [], values };
    }
    console.error('[admin] product save failed', error);
    return { error: 'UNAVAILABLE', fields: [], values };
};

/**
 * Saves the form through `save`, then expires the storefront's cached catalog so customers see
 * the change on their next request, and returns to the product list.
 */
const saveProduct = async (
    formData: FormData,
    save: (input: ProductInput) => Promise<unknown>,
): Promise<ProductFormState> => {
    const values = readValues(formData);
    try {
        await save(toProductInput(values));
    } catch (error) {
        return toFailure(error, values);
    }
    updateTag('catalog');
    redirect(PRODUCTS_PATH);
};

export const createProductAction = async (
    _previous: ProductFormState,
    formData: FormData,
): Promise<ProductFormState> => {
    await requireAdmin();
    return saveProduct(formData, createProduct);
};

/**
 * Edits and deactivates (an unchecked `active` box) a product. The form's `version` must match
 * the stored one, so a form loaded before another save is rejected instead of undoing it.
 */
export const updateProductAction = async (
    _previous: ProductFormState,
    formData: FormData,
): Promise<ProductFormState> => {
    await requireAdmin();
    const productId = formData.get('productId');
    const version = formData.get('version');
    return saveProduct(formData, (input) =>
        updateProduct(
            typeof productId === 'string' ? productId : '',
            input,
            typeof version === 'string' ? version : '',
        ),
    );
};
