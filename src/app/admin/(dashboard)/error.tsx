'use client';

import { ErrorState } from '@/components/ui/error-state';

/** Catches admin failures the pages do not handle themselves, e.g. a database outage. */
const AdminError = ({ error, retry }: { error: unknown; retry: () => void }) => (
    <ErrorState
        error={error}
        retry={retry}
        headingLevel="h1"
        heading="Něco se pokazilo"
        message="Stránku se teď nepodařilo načíst. Zkuste to prosím za chvíli znovu."
        homeHref="/admin/reservations"
    />
);

export default AdminError;
