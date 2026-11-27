'use client';

import Link from 'next/link';
import { unstable_isUnrecognizedActionError as isUnrecognizedActionError } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
    createManualReservation,
    type ManualReservationField,
    type ManualReservationResult,
} from '@/app/admin/(dashboard)/reservations/new/actions';
import { ADMIN_PICKUP_DATE_MESSAGES } from '@/components/admin/pickup-date-messages';
import { PRIMARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import { Notice } from '@/components/ui/notice';
import type { CalendarDate } from '@/lib/date-time/prague';
import { formatLongDate } from '@/lib/formatting/dates';
import { formatPrice } from '@/lib/formatting/money';
import type { AvailableProduct } from '@/server/services/products/get-available-products';

type Success = Extract<ManualReservationResult, { ok: true }>;

/** A server rejection, or a problem found before or around sending. */
type Failure =
    | Extract<ManualReservationResult, { ok: false }>
    | { ok: false; error: 'INVALID_QUANTITY'; productIds: string[] }
    | { ok: false; error: 'NO_RESPONSE' }
    | { ok: false; error: 'OUTDATED_PAGE' };

/** A product the form has shown; `offered` is false once a refresh no longer lists it. */
type ProductRow = AvailableProduct & { offered: boolean };

type ItemInput = { productId: string; quantity: number };

const FIELD_MESSAGES: Record<ManualReservationField, string> = {
    'customer.name': 'Zadejte jméno zákazníka (nejvýše 100 znaků).',
    'customer.phone': 'Zadejte telefon s 9–15 číslicemi, případně s předvolbou +.',
    items: 'Zadejte množství alespoň u jednoho produktu.',
    other: 'Neplatný požadavek.',
};

const INPUT_CLASSES =
    'rounded-lg border border-amber-300 bg-white px-3 py-2 text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700';

const describeFailure = (failure: Failure, productNames: ReadonlyMap<string, string>): string => {
    const nameOf = (productId: string) => productNames.get(productId) ?? 'neznámý produkt';
    switch (failure.error) {
        case 'INVALID_REQUEST':
            return failure.fields.map((field) => FIELD_MESSAGES[field]).join(' ');
        case 'INVALID_QUANTITY':
            return `Množství musí být celé nezáporné číslo: ${failure.productIds.map(nameOf).join(', ')}.`;
        case 'PRODUCT_UNAVAILABLE':
            return `Tyto produkty už v tento den nejsou v nabídce: ${failure.productIds.map(nameOf).join(', ')}. Odeberte je z objednávky.`;
        case 'INSUFFICIENT_CAPACITY':
            return `Nedostatečná kapacita: ${failure.shortages
                .map(
                    (shortage) =>
                        `${nameOf(shortage.productId)} (požadováno ${shortage.requested}, zbývá ${shortage.available})`,
                )
                .join(', ')}.`;
        case 'IDEMPOTENCY_CONFLICT':
            return 'Tato rezervace už mohla být uložena dříve. Než ji vytvoříte znovu, zkontrolujte seznam rezervací, ať nevznikne duplicita.';
        case 'NO_RESPONSE':
            return 'Nepodařilo se ověřit, zda byla rezervace uložena. Odešlete ji znovu beze změn (duplicita tak nevznikne), nebo nejdřív zkontrolujte seznam rezervací.';
        case 'OUTDATED_PAGE':
            return 'Aplikace byla mezitím aktualizována a rezervace nebyla uložena. Obnovte stránku a vytvořte ji znovu.';
        case 'UNAVAILABLE':
            return 'Rezervaci se nepodařilo uložit. Zkuste to prosím znovu.';
        default:
            return ADMIN_PICKUP_DATE_MESSAGES[failure.error];
    }
};

/**
 * Current products first, then earlier ones a refresh no longer lists but that still have a
 * quantity entered, so the order never loses a line silently: the server rejects it instead.
 */
const mergeProductRows = (
    previous: readonly ProductRow[],
    current: readonly AvailableProduct[],
    quantities: Readonly<Record<string, string>>,
): ProductRow[] => {
    const currentIds = new Set(current.map((product) => product.id));
    const withdrawn = previous
        .filter((row) => !currentIds.has(row.id) && (quantities[row.id] ?? '').trim() !== '')
        .map((row) => ({ ...row, offered: false }));
    return [...current.map((product) => ({ ...product, offered: true })), ...withdrawn];
};

/** Empty and zero mean "none"; anything else must be a whole number, or the row is invalid. */
const readItems = (
    rows: readonly ProductRow[],
    quantities: Readonly<Record<string, string>>,
): { items: ItemInput[]; invalidProductIds: string[] } => {
    const items: ItemInput[] = [];
    const invalidProductIds: string[] = [];
    for (const row of rows) {
        const value = (quantities[row.id] ?? '').trim();
        if (value === '') {
            continue;
        }
        const quantity = Number(value);
        if (!Number.isInteger(quantity) || quantity < 0) {
            invalidProductIds.push(row.id);
        } else if (quantity > 0) {
            items.push({ productId: row.id, quantity });
        }
    }
    return { items, invalidProductIds };
};

export const ManualReservationForm = ({
    pickupDate,
    products,
}: {
    pickupDate: CalendarDate;
    /** Remaining quantities are informational; the server checks capacity under lock. */
    products: readonly AvailableProduct[];
}) => {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [quantities, setQuantities] = useState<Record<string, string>>({});
    const [rows, setRows] = useState<ProductRow[]>(() =>
        products.map((product) => ({ ...product, offered: true })),
    );
    const [rowsSource, setRowsSource] = useState(products);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [success, setSuccess] = useState<Success | null>(null);
    const [isPending, startTransition] = useTransition();
    // Created on the first submission and reused by retries, so a retry after a lost response
    // returns the reservation already created instead of booking it twice. Any edit or a
    // success clears it.
    const idempotencyKey = useRef<string | null>(null);

    // A refresh after submitting brings new remaining quantities, or drops a withdrawn product.
    if (products !== rowsSource) {
        setRowsSource(products);
        setRows(mergeProductRows(rows, products, quantities));
    }

    const productNames = new Map(rows.map((row) => [row.id, row.name]));
    const { items, invalidProductIds } = readItems(rows, quantities);
    const pricesById = new Map(rows.map((row) => [row.id, row.price]));
    const totalPrice = items.reduce(
        (sum, item) => sum + (pricesById.get(item.productId) ?? 0) * item.quantity,
        0,
    );

    /** An edited request is a new request, so it must not reuse the previous key. */
    const startEdit = () => {
        idempotencyKey.current = null;
    };

    const submit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (invalidProductIds.length > 0) {
            setSuccess(null);
            setFailure({ ok: false, error: 'INVALID_QUANTITY', productIds: invalidProductIds });
            return;
        }
        idempotencyKey.current ??= crypto.randomUUID();
        const input = {
            idempotencyKey: idempotencyKey.current,
            pickupDate,
            customer: { name, phone },
            items,
        };
        setSuccess(null);
        startTransition(async () => {
            let result: ManualReservationResult;
            try {
                result = await createManualReservation(input);
            } catch (error) {
                // A new deployment no longer knows this page's action, so nothing was saved and
                // only a reload can submit again.
                if (isUnrecognizedActionError(error)) {
                    setFailure({ ok: false, error: 'OUTDATED_PAGE' });
                    return;
                }
                // The request may still have succeeded: keep the key so a retry replays it.
                setFailure({ ok: false, error: 'NO_RESPONSE' });
                return;
            }
            if (result.ok) {
                idempotencyKey.current = null;
                setName('');
                setPhone('');
                setQuantities({});
                setFailure(null);
                setSuccess(result);
                return;
            }
            // The key was already used, so it cannot succeed again; the message points to the list.
            if (result.error === 'IDEMPOTENCY_CONFLICT') {
                idempotencyKey.current = null;
            }
            setFailure(result);
        });
    };

    return (
        <form onSubmit={submit} className="flex flex-col gap-6">
            {success && (
                <Notice>
                    Rezervace <strong>{success.reservationNumber}</strong> na{' '}
                    {formatLongDate(success.pickupDate)} byla vytvořena (celkem{' '}
                    {formatPrice(success.totalPrice)}).{' '}
                    <Link
                        href={`/admin/reservations?date=${success.pickupDate}`}
                        className="font-medium text-amber-900 underline"
                    >
                        Zobrazit rezervace
                    </Link>
                </Notice>
            )}
            {failure && (
                <Notice tone="warning">
                    {describeFailure(failure, productNames)}
                    {(failure.error === 'IDEMPOTENCY_CONFLICT' ||
                        failure.error === 'NO_RESPONSE') && (
                        <>
                            {' '}
                            <Link
                                href={`/admin/reservations?date=${pickupDate}`}
                                className="font-medium underline"
                            >
                                Zobrazit rezervace
                            </Link>
                        </>
                    )}
                </Notice>
            )}
            <fieldset disabled={isPending} className="flex flex-col gap-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="manual-customer-name"
                            className="text-sm font-medium text-amber-950"
                        >
                            Jméno zákazníka
                        </label>
                        <input
                            id="manual-customer-name"
                            value={name}
                            onChange={(event) => {
                                startEdit();
                                setName(event.target.value);
                            }}
                            required
                            maxLength={100}
                            autoComplete="off"
                            className={INPUT_CLASSES}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="manual-customer-phone"
                            className="text-sm font-medium text-amber-950"
                        >
                            Telefon
                        </label>
                        <input
                            id="manual-customer-phone"
                            type="tel"
                            value={phone}
                            onChange={(event) => {
                                startEdit();
                                setPhone(event.target.value);
                            }}
                            required
                            autoComplete="off"
                            className={INPUT_CLASSES}
                        />
                    </div>
                </div>
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
                                    Zbývá
                                </th>
                                <th scope="col" className="px-4 py-3 text-right font-medium">
                                    Množství
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100">
                            {rows.map((product) => (
                                <tr key={product.id}>
                                    <td className="px-4 py-3 font-medium text-amber-950">
                                        <label htmlFor={`manual-quantity-${product.id}`}>
                                            {product.name}
                                        </label>
                                        {!product.offered && (
                                            <span className="block text-xs font-normal text-red-800">
                                                Už není v nabídce
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                        {formatPrice(product.price)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {product.offered ? product.remainingQuantity : '–'}
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input
                                            id={`manual-quantity-${product.id}`}
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            step={1}
                                            value={quantities[product.id] ?? ''}
                                            onChange={(event) => {
                                                startEdit();
                                                const { value } = event.target;
                                                setQuantities((current) => ({
                                                    ...current,
                                                    [product.id]: value,
                                                }));
                                            }}
                                            placeholder="0"
                                            className={`${INPUT_CLASSES} w-24 text-right`}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="text-stone-700">
                        Celkem: <strong>{formatPrice(totalPrice)}</strong>
                    </p>
                    <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
                        {isPending ? 'Ukládám…' : 'Vytvořit rezervaci'}
                    </button>
                </div>
            </fieldset>
        </form>
    );
};
