import { describe, expect, it } from 'vitest';
import { parseCrownsToHalere, productInputSchema } from '@/lib/validation/product';

const validProduct = {
    name: '  Rye bread ',
    description: '  ',
    imageUrl: '',
    price: 4550,
    defaultCapacity: 40,
    defaultWalkInQuantity: 10,
    active: true,
};

const issuePaths = (input: unknown) => {
    const result = productInputSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('parseCrownsToHalere', () => {
    it.each([
        ['45', 4500],
        ['45,5', 4550],
        ['45.50', 4550],
        ['0,05', 5],
        [' 1 234 ', 123_400],
        ['0', 0],
    ])('parses %j as %i haléře', (value, expected) => {
        expect(parseCrownsToHalere(value)).toBe(expected);
    });

    it.each(['', '-1', '45,505', '45,', ',5', 'abc', '1e3', '123456789'])('rejects %j', (value) => {
        expect(parseCrownsToHalere(value)).toBeNull();
    });
});

describe('productInputSchema', () => {
    it('trims text and stores blank optional fields as null', () => {
        expect(productInputSchema.parse(validProduct)).toEqual({
            ...validProduct,
            name: 'Rye bread',
            description: null,
            imageUrl: null,
        });
    });

    it('accepts missing optional fields and an https image URL', () => {
        expect(
            productInputSchema.parse({
                ...validProduct,
                description: undefined,
                imageUrl: ' https://example.com/rye.jpg ',
            }),
        ).toMatchObject({ description: null, imageUrl: 'https://example.com/rye.jpg' });
    });

    it.each(['javascript:alert(1)', 'ftp://example.com/a.jpg', 'not a url'])(
        'rejects the image URL %j',
        (imageUrl) => {
            expect(issuePaths({ ...validProduct, imageUrl })).toEqual(['imageUrl']);
        },
    );

    it('rejects a blank name', () => {
        expect(issuePaths({ ...validProduct, name: '   ' })).toEqual(['name']);
    });

    it.each([Number.NaN, -1, 1.5, 2_147_483_648])('rejects the price %d', (price) => {
        expect(issuePaths({ ...validProduct, price })).toEqual(['price']);
    });

    it('rejects a walk-in quantity above capacity', () => {
        expect(
            issuePaths({ ...validProduct, defaultCapacity: 5, defaultWalkInQuantity: 6 }),
        ).toEqual(['defaultWalkInQuantity']);
    });
});
