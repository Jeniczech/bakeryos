import { randomUUID } from 'node:crypto';

/** Product names are unique, so fixtures that insert several products add a random suffix. */
export const uniqueProductName = (base: string): string => `${base} ${randomUUID().slice(0, 8)}`;
