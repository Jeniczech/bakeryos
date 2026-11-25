'use client';

import { useActionState } from 'react';
import { logIn, type LoginError, type LoginState } from '@/app/admin/login/actions';
import { Notice } from '@/components/ui/notice';

const ERROR_MESSAGES: Record<LoginError, string> = {
    INVALID_CREDENTIALS: 'Nesprávný e-mail nebo heslo.',
    RATE_LIMITED: 'Příliš mnoho pokusů o přihlášení. Zkuste to prosím znovu za 15 minut.',
    UNAVAILABLE: 'Přihlášení se nezdařilo. Zkuste to prosím znovu.',
};

const INITIAL_STATE: LoginState = { error: null, email: '' };

const INPUT_CLASSES =
    'rounded-lg border border-amber-300 bg-white px-3 py-2 text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-700';

export const LoginForm = () => {
    const [state, formAction, isPending] = useActionState(logIn, INITIAL_STATE);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            {state.error && <Notice tone="warning">{ERROR_MESSAGES[state.error]}</Notice>}
            <div className="flex flex-col gap-1">
                <label htmlFor="login-email" className="text-sm font-medium text-amber-950">
                    E-mail
                </label>
                <input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    defaultValue={state.email}
                    required
                    className={INPUT_CLASSES}
                />
            </div>
            <div className="flex flex-col gap-1">
                <label htmlFor="login-password" className="text-sm font-medium text-amber-950">
                    Heslo
                </label>
                <input
                    id="login-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className={INPUT_CLASSES}
                />
            </div>
            <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-amber-800 px-4 py-3 font-semibold text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
                {isPending ? 'Přihlašuji…' : 'Přihlásit se'}
            </button>
        </form>
    );
};
