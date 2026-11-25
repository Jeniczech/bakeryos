'use client';

import { createContext, use, useMemo, useState } from 'react';
import type { CustomerDetails } from '@/lib/cart/customer-details';

type CustomerField = keyof CustomerDetails;

type CustomerContextValue = {
    customer: CustomerDetails;
    /** Fields the customer has left; their errors are shown. */
    touched: Record<CustomerField, boolean>;
    setField: (field: CustomerField, value: string) => void;
    markTouched: (field: CustomerField) => void;
};

const CustomerContext = createContext<CustomerContextValue | null>(null);

/**
 * The customer's details, in the order layout so they survive date switches. Separate from the
 * cart's context, so typing does not re-render the product cards. Kept in memory only.
 */
export const CustomerProvider = ({ children }: { children: React.ReactNode }) => {
    const [customer, setCustomer] = useState<CustomerDetails>({ name: '', phone: '' });
    const [touched, setTouched] = useState({ name: false, phone: false });
    const value = useMemo(
        (): CustomerContextValue => ({
            customer,
            touched,
            setField: (field, fieldValue) =>
                setCustomer((current) => ({ ...current, [field]: fieldValue })),
            markTouched: (field) => setTouched((current) => ({ ...current, [field]: true })),
        }),
        [customer, touched],
    );
    return <CustomerContext value={value}>{children}</CustomerContext>;
};

export const useCustomer = (): CustomerContextValue => {
    const context = use(CustomerContext);
    if (!context) {
        throw new Error('useCustomer must be used within a CustomerProvider.');
    }
    return context;
};
