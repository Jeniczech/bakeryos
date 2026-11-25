import { describe, expect, it } from 'vitest';
import { validateCustomerDetails } from '@/lib/cart/customer-details';

describe('validateCustomerDetails', () => {
    it('accepts a name and a lightly formatted phone number', () => {
        expect(validateCustomerDetails({ name: ' Jana ', phone: '+420 (777) 123-456' })).toEqual({
            name: null,
            phone: null,
        });
    });

    it('requires both fields', () => {
        expect(validateCustomerDetails({ name: '   ', phone: ' ' })).toEqual({
            name: 'REQUIRED',
            phone: 'REQUIRED',
        });
    });

    it('limits names to 100 characters after trimming', () => {
        const valid = (name: string) => validateCustomerDetails({ name, phone: '777123456' }).name;
        expect(valid('a'.repeat(101))).toBe('TOO_LONG');
        expect(valid(`  ${'a'.repeat(100)}  `)).toBeNull();
    });

    it('rejects phone numbers outside 9–15 digits or with other characters', () => {
        for (const phone of ['12345678', '1234567890123456', '777 123 45x', '++420777123456']) {
            expect(validateCustomerDetails({ name: 'Jana', phone }).phone).toBe('INVALID');
        }
    });
});
