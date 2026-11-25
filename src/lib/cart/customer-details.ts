import { customerNameSchema, phoneSchema } from '@/lib/validation/reservation';

export type CustomerDetails = { name: string; phone: string };

export type CustomerDetailsErrors = {
    name: 'REQUIRED' | 'TOO_LONG' | null;
    phone: 'REQUIRED' | 'INVALID' | null;
};

/**
 * Checks the details with the same schemas the reservation API applies, returning error codes
 * the UI maps to its own copy (the schemas' messages are the API's English ones).
 */
export const validateCustomerDetails = ({
    name,
    phone,
}: CustomerDetails): CustomerDetailsErrors => ({
    name: customerNameSchema.safeParse(name).success
        ? null
        : name.trim() === ''
          ? 'REQUIRED'
          : 'TOO_LONG',
    phone: phoneSchema.safeParse(phone).success
        ? null
        : phone.trim() === ''
          ? 'REQUIRED'
          : 'INVALID',
});

export const hasCustomerDetailsErrors = (errors: CustomerDetailsErrors): boolean =>
    errors.name !== null || errors.phone !== null;
