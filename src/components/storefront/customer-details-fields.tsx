'use client';

import { useId, useState } from 'react';
import {
    validateCustomerDetails,
    type CustomerDetails,
    type CustomerDetailsErrors,
} from '@/lib/cart/customer-details';
import { CUSTOMER_NAME_MAX_LENGTH } from '@/lib/validation/reservation';
import { useCart } from './cart-provider';

const NAME_ERROR_MESSAGES: Record<NonNullable<CustomerDetailsErrors['name']>, string> = {
    REQUIRED: 'Vyplňte prosím jméno.',
    TOO_LONG: `Jméno může mít nejvýše ${CUSTOMER_NAME_MAX_LENGTH} znaků.`,
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
 * Name and phone for the reservation, kept in the cart provider. A field's error shows once
 * the customer has left it, so nobody is warned while still typing.
 */
export const CustomerDetailsFields = () => {
    const { customer, setCustomer } = useCart();
    const [touched, setTouched] = useState({ name: false, phone: false });
    const errors = validateCustomerDetails(customer);
    const fieldProps = (field: keyof CustomerDetails) => ({
        value: customer[field],
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const { value } = event.target;
            setCustomer((current) => ({ ...current, [field]: value }));
        },
        onBlur: () => setTouched((current) => ({ ...current, [field]: true })),
    });
    return (
        <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-semibold text-amber-950">Kontaktní údaje</legend>
            <TextField
                {...fieldProps('name')}
                label="Jméno a příjmení"
                error={touched.name && errors.name ? NAME_ERROR_MESSAGES[errors.name] : null}
                type="text"
                autoComplete="name"
                maxLength={CUSTOMER_NAME_MAX_LENGTH}
                required
            />
            <TextField
                {...fieldProps('phone')}
                label="Telefon"
                error={touched.phone && errors.phone ? PHONE_ERROR_MESSAGES[errors.phone] : null}
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+420 777 123 456"
                required
            />
        </fieldset>
    );
};
