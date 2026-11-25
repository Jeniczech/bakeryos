'use server';

import { AuthError, CredentialsSignin } from 'next-auth';
import { signIn } from '@/server/auth/auth';
import { ADMIN_HOME_PATH } from '@/server/auth/require-admin';

export type LoginError = 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAVAILABLE';

export type LoginState = { error: LoginError | null; email: string };

const readField = (formData: FormData, name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
};

/** Redirects to the dashboard on success; `signIn`'s redirect must propagate, so only auth errors are caught. */
export const logIn = async (_previous: LoginState, formData: FormData): Promise<LoginState> => {
    const email = readField(formData, 'email');
    try {
        await signIn('credentials', {
            email,
            password: readField(formData, 'password'),
            redirectTo: ADMIN_HOME_PATH,
        });
    } catch (error) {
        if (error instanceof CredentialsSignin) {
            const reason = error.code === 'rate_limited' ? 'RATE_LIMITED' : 'INVALID_CREDENTIALS';
            return { error: reason, email };
        }
        if (error instanceof AuthError) {
            return { error: 'UNAVAILABLE', email };
        }
        throw error;
    }
    return { error: null, email };
};
