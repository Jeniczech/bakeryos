import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getClientIp } from '@/server/http/client-ip';
import { authenticateAdmin } from './authenticate-admin';

export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/** Surfaced to the login form as `error.code`; carries no hint about the account. */
export class LoginRateLimitedError extends CredentialsSignin {
    code = 'rate_limited';
}

/**
 * Sign-in and sign-out run only through Server Actions, which call Auth.js directly, so the
 * `/api/auth/*` route handlers are deliberately not mounted.
 */
export const { auth, signIn, signOut } = NextAuth({
    providers: [
        Credentials({
            credentials: { email: {}, password: {} },
            authorize: async (credentials, request) => {
                const result = await authenticateAdmin(credentials, {
                    clientIp: getClientIp(request.headers),
                });
                if (result.ok) {
                    return result.admin;
                }
                if (result.reason === 'RATE_LIMITED') {
                    throw new LoginRateLimitedError();
                }
                return null;
            },
        }),
    ],
    // Auth.js trusts the Host header only on platforms it recognizes, and Netlify is not one of
    // them. Netlify's edge sets the host, deploy previews have their own, and every redirect
    // target here is a fixed relative path.
    trustHost: true,
    session: { strategy: 'jwt', maxAge: ADMIN_SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/admin/login' },
    callbacks: {
        session: ({ session, token }) => {
            if (token.sub) {
                session.user.id = token.sub;
            }
            return session;
        },
    },
    logger: {
        // A failed login is an expected outcome, not a server error.
        error: (error) => {
            if (!(error instanceof CredentialsSignin)) {
                console.error('[auth]', error);
            }
        },
    },
});
