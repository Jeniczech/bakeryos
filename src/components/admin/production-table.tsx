'use client';

import { useActionState } from 'react';
import {
    updateDailyPlanAction,
    type DailyPlanField,
    type DailyPlanFormState,
} from '@/app/admin/(dashboard)/production/actions';
import { SECONDARY_BUTTON_CLASSES } from '@/components/ui/button-classes';
import type { DailyProductionRow } from '@/server/services/production/get-daily-production';

const INITIAL_STATE: DailyPlanFormState = {
    error: null,
    fields: [],
    committedQuantity: null,
    values: null,
    saved: false,
};

const errorMessage = (state: DailyPlanFormState): string | null => {
    switch (state.error) {
        case null:
            return null;
        case 'INVALID_REQUEST':
            return 'Zadejte celá nezáporná čísla; pultový prodej nesmí převýšit kapacitu.';
        case 'BELOW_COMMITMENTS':
            return `Kapacita musí pokrýt pultový prodej a ${state.committedQuantity} už rezervovaných kusů.`;
        case 'DATE_UNAVAILABLE':
            return 'Plán pro tento den už nelze měnit.';
        case 'PRODUCT_UNAVAILABLE':
            return 'Produkt se v tento den nenabízí.';
        case 'UNAVAILABLE':
            return 'Plán se nepodařilo uložit. Zkuste to prosím znovu.';
    }
};

const INPUT_CLASSES =
    'w-20 rounded-lg border border-amber-300 bg-white px-2 py-1 text-right text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700 aria-invalid:border-red-700';

const CELL = 'px-4 py-3 text-right';

const QuantityInput = ({
    field,
    label,
    formId,
    defaultValue,
    state,
}: {
    field: DailyPlanField;
    label: string;
    formId: string;
    defaultValue: string;
    state: DailyPlanFormState;
}) => (
    <input
        form={formId}
        name={field}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        required
        aria-label={label}
        defaultValue={defaultValue}
        aria-invalid={state.fields.includes(field) || undefined}
        aria-describedby={state.error ? `${formId}-error` : undefined}
        className={INPUT_CLASSES}
    />
);

const SharedCells = ({ row }: { row: DailyProductionRow }) => (
    <>
        <td className={CELL}>{row.activeReserved}</td>
        <td className={CELL}>{row.retainedCancelled}</td>
    </>
);

const ResultCells = ({ row }: { row: DailyProductionRow }) => (
    <>
        <td className={`${CELL} font-semibold text-amber-950`}>{row.recommendedProduction}</td>
        <td className={CELL}>{row.remainingAvailability}</td>
    </>
);

const ProductCell = ({ row }: { row: DailyProductionRow }) => (
    <th scope="row" className="px-4 py-3 text-left font-medium">
        {row.productName}
        {!row.active && <span className="ml-2 text-xs font-normal">(neaktivní)</span>}
    </th>
);

/**
 * Inputs sit in their own cells and join the row's form through the `form` attribute, since a
 * form cannot wrap a table row.
 */
const EditableRow = ({ row, date }: { row: DailyProductionRow; date: string }) => {
    const [state, formAction, pending] = useActionState(updateDailyPlanAction, INITIAL_STATE);
    const formId = `plan-${row.productId}`;
    const message = errorMessage(state);
    return (
        <tr>
            <ProductCell row={row} />
            <td className={CELL}>
                <QuantityInput
                    field="capacity"
                    label={`Kapacita – ${row.productName}`}
                    formId={formId}
                    defaultValue={state.values?.capacity ?? String(row.capacity)}
                    state={state}
                />
            </td>
            <SharedCells row={row} />
            <td className={CELL}>
                <QuantityInput
                    field="walkInQuantity"
                    label={`Pultový prodej – ${row.productName}`}
                    formId={formId}
                    defaultValue={state.values?.walkInQuantity ?? String(row.walkInQuantity)}
                    state={state}
                />
            </td>
            <ResultCells row={row} />
            <td className="px-4 py-3">
                <form id={formId} action={formAction} className="flex flex-col items-end gap-1">
                    <input type="hidden" name="productId" value={row.productId} />
                    <input type="hidden" name="date" value={date} />
                    <button type="submit" disabled={pending} className={SECONDARY_BUTTON_CLASSES}>
                        Uložit<span className="sr-only"> {row.productName}</span>
                    </button>
                    {message && (
                        <p
                            id={`${formId}-error`}
                            role="alert"
                            className="w-48 text-sm text-red-800"
                        >
                            {message}
                        </p>
                    )}
                    {state.saved && !pending && (
                        <p role="status" className="text-sm text-green-800">
                            Uloženo
                        </p>
                    )}
                </form>
            </td>
        </tr>
    );
};

const ReadOnlyRow = ({ row }: { row: DailyProductionRow }) => (
    <tr className={row.active ? undefined : 'text-stone-500'}>
        <ProductCell row={row} />
        <td className={CELL}>{row.capacity}</td>
        <SharedCells row={row} />
        <td className={CELL}>{row.walkInQuantity}</td>
        <ResultCells row={row} />
        <td className="px-4 py-3" />
    </tr>
);

export const ProductionTable = ({
    date,
    rows,
}: {
    date: string;
    rows: readonly DailyProductionRow[];
}) => (
    <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white shadow-sm">
        <table className="w-full text-sm">
            <thead className="border-b border-amber-200 bg-amber-50 text-stone-600">
                <tr>
                    <th scope="col" className="px-4 py-3 text-left font-medium">
                        Produkt
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Kapacita
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Rezervováno
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Zrušeno po uzávěrce
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Pultový prodej
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Upéct
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                        Volné k rezervaci
                    </th>
                    <th scope="col" className="px-4 py-3">
                        <span className="sr-only">Akce</span>
                    </th>
                </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
                {rows.map((row) =>
                    row.editable ? (
                        <EditableRow key={row.productId} row={row} date={date} />
                    ) : (
                        <ReadOnlyRow key={row.productId} row={row} />
                    ),
                )}
            </tbody>
        </table>
    </div>
);
