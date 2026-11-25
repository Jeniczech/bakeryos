'use server';

import { signOut } from '@/server/auth/auth';
import { ADMIN_LOGIN_PATH } from '@/server/auth/require-admin';

export const logOut = async (): Promise<void> => {
    await signOut({ redirectTo: ADMIN_LOGIN_PATH });
};
