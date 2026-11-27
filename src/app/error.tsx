'use client';

import { ErrorState } from '@/components/ui/error-state';

/** Catches failures outside the storefront and admin dashboard boundaries, e.g. on the admin login. */
const RootError = ({ error, retry }: { error: unknown; retry: () => void }) => (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-12">
        <ErrorState
            error={error}
            retry={retry}
            headingLevel="h1"
            heading="Něco se pokazilo"
            message="Stránku se teď nepodařilo načíst. Zkuste to prosím za chvíli znovu."
        />
    </main>
);

export default RootError;
