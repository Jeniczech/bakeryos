'use client';

import { ErrorState } from '@/components/storefront/error-state';

/** Catches storefront failures the pages do not handle themselves, e.g. a database outage. */
const StorefrontError = ({ error, retry }: { error: unknown; retry: () => void }) => (
    <ErrorState
        error={error}
        retry={retry}
        headingLevel="h1"
        heading="Něco se pokazilo"
        message="Stránku se teď nepodařilo načíst. Zkuste to prosím za chvíli znovu."
    />
);

export default StorefrontError;
