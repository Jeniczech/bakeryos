import { describe, expect, it } from 'vitest';
import { formatCrownsInput, formatPrice } from '@/lib/formatting/money';

// Intl separates the amount and the currency with a no-break space.
const normalizeSpaces = (value: string) => value.replace(/\s/g, ' ');

describe('formatPrice', () => {
    it('omits haléře for whole crowns', () => {
        expect(normalizeSpaces(formatPrice(4500))).toBe('45 Kč');
        expect(normalizeSpaces(formatPrice(0))).toBe('0 Kč');
    });

    it('shows haléře otherwise', () => {
        expect(normalizeSpaces(formatPrice(4550))).toBe('45,50 Kč');
        expect(normalizeSpaces(formatPrice(5))).toBe('0,05 Kč');
    });

    it('groups thousands', () => {
        expect(normalizeSpaces(formatPrice(123_400))).toBe('1 234 Kč');
    });
});

describe('formatCrownsInput', () => {
    it.each([
        [4500, '45'],
        [4550, '45,50'],
        [4505, '45,05'],
        [5, '0,05'],
        [0, '0'],
    ])('formats %i haléře as %j', (halere, expected) => {
        expect(formatCrownsInput(halere)).toBe(expected);
    });
});
