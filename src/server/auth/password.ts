import { hash } from '@node-rs/argon2';

// Argon2id with the library defaults (m=19456 KiB, t=2, p=1), verified on Netlify in Stage 1.
// Parameters are encoded in the hash, so verification needs no configuration.
export const hashPassword = (password: string): Promise<string> => hash(password);
