import { LoginForm } from '@/components/admin/login-form';

const LoginPage = () => (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
        <div className="flex flex-col gap-1">
            <p className="text-xl font-semibold tracking-tight text-amber-900">BakeryOS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-amber-950">
                Přihlášení do administrace
            </h1>
        </div>
        <div className="rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
            <LoginForm />
        </div>
    </main>
);

export default LoginPage;
