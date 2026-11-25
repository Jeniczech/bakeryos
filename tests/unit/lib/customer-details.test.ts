import { describe, expect, it } from 'vitest';
import { hasCustomerDetailsErrors, validateCustomerDetails } from '@/lib/cart/customer-details';

describe('validateCustomerDetails', () => {
    it('accepts a name and a lightly formatted phone number', () => {
        const errors = validateCustomerDetails({ name: ' Jana ', phone: '+420 (777) 123-456' });
        expect(errors).toEqual({ name: null, phone: null });
        expect(hasCustomerDetailsErrors(errors)).toBe(false);
    });

    it('requires both fields', () => {
        const errors = validateCustomerDetails({ name: '   ', phone: ' ' });
        expect(errors).toEqual({ name: 'REQUIRED', phone: 'REQUIRED' });
        expect(hasCustomerDetailsErrors(errors)).toBe(true);
    });

    it('rejects names over 100 characters', () => {
        expect(validateCustomerDetails({ name: 'a'.repeat(101), phone: '777123456' }).name).toBe(
            'TOO_LONG',
        );
        expect(
            validateCustomerDetails({ name: 'a'.repeat(100), phone: '777123456' }).name,
        ).toBeNull();
    });

    it('rejects phone numbers outside 9–15 digits or with other characters', () => {
        for (const phone of ['12345678', '1234567890123456', '777 123 45x', '++420777123456']) {
            expect(validateCustomerDetails({ name: 'Jana', phone }).phone).toBe('INVALID');
        }
    });
});
