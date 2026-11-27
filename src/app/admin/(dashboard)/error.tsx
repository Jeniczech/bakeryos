'use client';

import { unstable_isUnrecognizedActionError as isUnrecognizedActionError } from 'next/navigation';
import { ErrorState } from '@/components/ui/error-state';

/** Catches admin failures the pages do not handle themselves, e.g. a database outage. */
const AdminError = ({ error, retry }: { error: unknown; retry: () => void }) => {
    // A tab open across a deployment calls Server Action IDs the new build no longer has. Nothing
    // was saved, and only a full reload loads the current actions; `retry` would keep the old ones.
    if (isUnrecognizedActionError(error)) {
        return (
            <ErrorState
                error={error}
                retry={() => window.location.reload()}
                retryLabel="Obnovit stránku"
                headingLevel="h1"
                heading="Aplikace byla aktualizována"
                message="Aplikace byla mezitím aktualizována a změna nebyla uložena. Obnovte stránku a akci zopakujte."
                homeHref="/admin/reservations"
            />
        );
    }
    return (
        <ErrorState
            error={error}
            retry={retry}
            headingLevel="h1"
            heading="Něco se pokazilo"
            message="Stránku se teď nepodařilo načíst. Zkuste to prosím za chvíli znovu."
            homeHref="/admin/reservations"
        />
    );
};

export default AdminError;
