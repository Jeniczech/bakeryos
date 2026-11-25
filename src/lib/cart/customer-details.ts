import { customerNameSchema, phoneSchema } from '@/lib/validation/reservation';

export type CustomerDetails = { name: string; phone: string };

export type CustomerDetailsErrors = {
    name: 'REQUIRED' | 'TOO_LONG' | 'INVALID' | null;
    phone: 'REQUIRED' | 'INVALID' | null;
};

const NAME_ISSUE_ERRORS: Partial<Record<string, CustomerDetailsErrors['name']>> = {
    too_small: 'REQUIRED',
    too_big: 'TOO_LONG',
};

const getNameError = (name: string): CustomerDetailsErrors['name'] => {
    const result = customerNameSchema.safeParse(name);
    return result.success ? null : (NAME_ISSUE_ERRORS[result.error.issues[0].code] ?? 'INVALID');
};

const getPhoneError = (phone: string): CustomerDetailsErrors['phone'] => {
    if (phone.trim() === '') {
        return 'REQUIRED';
    }
    return phoneSchema.safeParse(phone).success ? null : 'INVALID';
};

/**
 * Checks the details with the same schemas the reservation API applies, returning error codes
 * the UI maps to its own copy (the schemas' messages are the API's English ones).
 */
export const validateCustomerDetails = ({
    name,
    phone,
}: CustomerDetails): CustomerDetailsErrors => ({
    name: getNameError(name),
    phone: getPhoneError(phone),
});
