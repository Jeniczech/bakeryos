/** The stable `code` of a Problem Details body, or null when the body has none. */
export const readProblemCode = (body: unknown): string | null =>
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
        ? body.code
        : null;
