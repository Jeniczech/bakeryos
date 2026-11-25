'use client';

import { useId } from 'react';
import { validateCustomerDetails, type CustomerDetailsErrors } from '@/lib/cart/customer-details';
import { CUSTOMER_NAME_MAX_LENGTH } from '@/lib/validation/reservation';
import { useCart } from './cart-provider';
import { useCustomer } from './customer-provider';

const NAME_ERROR_MESSAGES: Record<NonNullable<CustomerDetailsErrors['name']>, string> = {
    REQUIRED: 'Vyplňte prosím jméno.',
    TOO_LONG: `Jméno může mít nejvýše ${CUSTOMER_NAME_MAX_LENGTH} znaků.`,
    INVALID: 'Zadejte prosím platné jméno.',
};

const PHONE_ERROR_MESSAGES: Record<NonNullable<CustomerDetailsErrors['phone']>, string> = {
    REQUIRED: 'Vyplňte prosím telefon.',
    INVALID: 'Zadejte telefon s 9–15 číslicemi, případně s + na začátku.',
};

const TextField = ({
    label,
    error,
    ...inputProps
}: { label: string; error: string | null } & React.ComponentProps<'input'>) => {
    const id = useId();
    const errorId = `${id}-error`;
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-amber-950">
                {label}
            </label>
            <input
                id={id}
                aria-invalid={error !== null}
                aria-describedby={error ? errorId : undefined}
                className={`rounded-lg border bg-white px-3 py-2 text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700 ${
                    error ? 'border-orange-400' : 'border-amber-300'
                }`}
                {...inputProps}
            />
            {error && (
                <p id={errorId} className="text-sm text-orange-800">
                    {error}
                </p>
            )}
        </div>
    );
};

/**
 * Name and phone for the reservation, shown while the cart has items. Rendered outside the
 * cart's loading boundary, so a field is never replaced while the customer types. A field's
 * error shows once the customer has left it.
 */
export const CustomerDetailsCard = () => {
    const { cart } = useCart();
    const { customer, touched, setField, markTouched } = useCustomer();
    const headingId = useId();
    if (cart.length === 0) {
        return null;
    }
    const errors = validateCustomerDetails(customer);
    return (
        <section
            aria-labelledby={headingId}
            className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm"
        >
            <h2 id={headingId} className="text-lg font-semibold text-amber-950">
                Kontaktní údaje
            </h2>
            <TextField
                label="Jméno a příjmení"
                error={touched.name && errors.name ? NAME_ERROR_MESSAGES[errors.name] : null}
                value={customer.name}
                onChange={(event) => setField('name', event.target.value)}
                onBlur={() => markTouched('name')}
                type="text"
                autoComplete="name"
                required
            />
            <TextField
                label="Telefon"
                error={touched.phone && errors.phone ? PHONE_ERROR_MESSAGES[errors.phone] : null}
                value={customer.phone}
                onChange={(event) => setField('phone', event.target.value)}
                onBlur={() => markTouched('phone')}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+420 777 123 456"
                required
            />
        </section>
    );
};
