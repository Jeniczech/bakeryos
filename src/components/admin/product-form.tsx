'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useId } from 'react';
import {
    createProductAction,
    updateProductAction,
    type ProductField,
    type ProductFormState,
    type ProductFormValues,
} from '@/app/admin/(dashboard)/products/actions';
import { PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import { PRODUCT_DESCRIPTION_MAX_LENGTH, PRODUCT_NAME_MAX_LENGTH } from '@/lib/validation/product';

const FIELD_MESSAGES: Record<ProductField, string> = {
    name: `Zadejte název (nejvýše ${PRODUCT_NAME_MAX_LENGTH} znaků).`,
    description: `Popis může mít nejvýše ${PRODUCT_DESCRIPTION_MAX_LENGTH} znaků.`,
    price: 'Zadejte cenu v Kč, nejvýše se dvěma desetinnými místy (např. 45 nebo 45,50).',
    defaultCapacity: 'Zadejte kapacitu jako celé nezáporné číslo.',
    defaultWalkInQuantity:
        'Zadejte množství pro pultový prodej jako celé nezáporné číslo, nejvýše rovné kapacitě.',
};

const NAME_TAKEN_MESSAGE =
    'Zvolte jiný název. Pokud jde o neaktivní produkt, upravte ho a znovu aktivujte.';

const ERROR_MESSAGES: Record<Exclude<ProductFormState['error'], null>, string> = {
    INVALID_REQUEST: 'Opravte prosím zvýrazněná pole.',
    NAME_TAKEN: 'Produkt s tímto názvem už existuje.',
    NOT_FOUND: 'Produkt nebyl nalezen.',
    CHANGED:
        'Produkt mezitím někdo upravil, změny proto nebyly uloženy. Načtěte aktuální údaje a upravte je znovu.',
    UNAVAILABLE: 'Produkt se nepodařilo uložit. Zkuste to prosím znovu.',
};

const INPUT_CLASSES =
    'rounded-lg border border-amber-300 bg-white px-3 py-2 text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700 aria-invalid:border-red-700';

const EMPTY_VALUES: ProductFormValues = {
    name: '',
    description: '',
    price: '',
    defaultCapacity: '',
    defaultWalkInQuantity: '0',
    active: true,
};

const TextField = ({
    field,
    label,
    hint,
    state,
    idPrefix,
    ...inputProps
}: {
    field: ProductField;
    label: string;
    hint?: string;
    state: ProductFormState;
    idPrefix: string;
} & Omit<React.ComponentProps<'input'>, 'name' | 'id' | 'defaultValue'>) => {
    const id = `${idPrefix}-${field}`;
    const invalid = state.fields.includes(field);
    const describedBy = [hint && `${id}-hint`, invalid && `${id}-error`].filter(Boolean).join(' ');
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-amber-950">
                {label}
            </label>
            <input
                id={id}
                name={field}
                defaultValue={state.values[field]}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy || undefined}
                className={INPUT_CLASSES}
                {...inputProps}
            />
            {hint && (
                <p id={`${id}-hint`} className="text-xs text-stone-600">
                    {hint}
                </p>
            )}
            {invalid && (
                <p id={`${id}-error`} className="text-sm text-red-800">
                    {field === 'name' && state.error === 'NAME_TAKEN'
                        ? NAME_TAKEN_MESSAGE
                        : FIELD_MESSAGES[field]}
                </p>
            )}
        </div>
    );
};

type EditedProduct = { id: string; version: string; values: ProductFormValues };

/**
 * Creates a product, or edits one when `product` is given. Next.js keeps visited pages mounted
 * while hidden, so the form is keyed to start fresh: on each new visit (`bfcacheId`, kept on
 * back/forward) and whenever the product was saved (`version`). Otherwise a reopened editor
 * would show the values it was first loaded with.
 */
export const ProductForm = ({ product }: { product?: EditedProduct }) => {
    const { bfcacheId } = useRouter();
    return (
        <ProductFormFields key={`${bfcacheId}:${product?.version ?? 'new'}`} product={product} />
    );
};

/**
 * Rejected input comes back from the action with the submitted values, which become the inputs'
 * defaults after React resets the form.
 */
const ProductFormFields = ({ product }: { product?: EditedProduct }) => {
    const [state, formAction, pending] = useActionState(
        product ? updateProductAction : createProductAction,
        { error: null, fields: [], values: product?.values ?? EMPTY_VALUES },
    );
    // Unique per form: Next.js keeps visited pages mounted while hidden, so a create and an
    // edit form can both be in the document.
    const idPrefix = useId();
    const descriptionId = `${idPrefix}-description`;
    const descriptionInvalid = state.fields.includes('description');

    return (
        <form action={formAction} className="flex max-w-2xl flex-col gap-6">
            {product && (
                <>
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="version" value={product.version} />
                </>
            )}
            {state.error && (
                <Notice tone="warning">
                    {ERROR_MESSAGES[state.error]}
                    {state.error === 'CHANGED' && product && (
                        <>
                            {' '}
                            {/* A fresh navigation remounts the form with the stored values. */}
                            <Link
                                href={`/admin/products/${product.id}`}
                                className="font-medium underline"
                            >
                                Načíst aktuální údaje
                            </Link>
                        </>
                    )}
                </Notice>
            )}
            <fieldset disabled={pending} className="flex flex-col gap-4">
                <TextField
                    field="name"
                    label="Název"
                    state={state}
                    idPrefix={idPrefix}
                    required
                    maxLength={PRODUCT_NAME_MAX_LENGTH}
                    autoComplete="off"
                />
                <div className="flex flex-col gap-1">
                    <label htmlFor={descriptionId} className="text-sm font-medium text-amber-950">
                        Popis (nepovinný)
                    </label>
                    <textarea
                        id={descriptionId}
                        name="description"
                        defaultValue={state.values.description}
                        rows={3}
                        maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
                        aria-invalid={descriptionInvalid || undefined}
                        aria-describedby={descriptionInvalid ? `${descriptionId}-error` : undefined}
                        className={INPUT_CLASSES}
                    />
                    {descriptionInvalid && (
                        <p id={`${descriptionId}-error`} className="text-sm text-red-800">
                            {FIELD_MESSAGES.description}
                        </p>
                    )}
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                    <TextField
                        field="price"
                        label="Cena (Kč)"
                        state={state}
                        idPrefix={idPrefix}
                        required
                        inputMode="decimal"
                        autoComplete="off"
                    />
                    <TextField
                        field="defaultCapacity"
                        label="Výchozí denní kapacita"
                        state={state}
                        idPrefix={idPrefix}
                        required
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                    />
                    <TextField
                        field="defaultWalkInQuantity"
                        label="Výchozí pultový prodej"
                        hint="Kusy z kapacity, které se nerezervují."
                        state={state}
                        idPrefix={idPrefix}
                        required
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                    />
                </div>
                <p className="text-sm text-stone-600">
                    Změna výchozích hodnot neovlivní dny, pro které už existuje denní plán.
                </p>
                <label className="flex items-start gap-2">
                    <input
                        type="checkbox"
                        name="active"
                        defaultChecked={state.values.active}
                        className="mt-1 size-4 accent-amber-800"
                    />
                    <span>
                        <span className="font-medium text-amber-950">Aktivní</span>
                        <span className="block text-sm text-stone-600">
                            Neaktivní produkt nelze nově rezervovat. Stávající rezervace zůstanou
                            beze změny.
                        </span>
                    </span>
                </label>
            </fieldset>
            <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASSES}>
                    {pending ? 'Ukládáme…' : product ? 'Uložit změny' : 'Vytvořit produkt'}
                </button>
                <Link href="/admin/products" className={SECONDARY_BUTTON_CLASSES}>
                    Zrušit
                </Link>
            </div>
        </form>
    );
};
