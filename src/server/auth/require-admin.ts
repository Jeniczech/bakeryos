import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { auth } from './auth';
import type { AuthenticatedAdmin } from './authenticate-admin';

export const ADMIN_LOGIN_PATH = '/admin/login';
export const ADMIN_HOME_PATH = '/admin/reservations';

/**
 * The authorization guard: every admin read and Server Action calls it, because layout
 * redirects only run on navigation. Reads the request's cookies, so pages must call it inside
 * a `<Suspense>` boundary.
 */
export const requireAdmin = async (): Promise<AuthenticatedAdmin> => {
    // Auth.js decrypts the session with random values and clock reads, which Cache Components
    // reject in a prerender even after cookies are read.
    await connection();
    const session = await auth();
    const id = session?.user?.id;
    const email = session?.user?.email;
    if (!id || !email) {
        redirect(ADMIN_LOGIN_PATH);
    }
    return { id, email };
};
