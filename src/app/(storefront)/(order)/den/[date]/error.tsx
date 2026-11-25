'use client';

import { ErrorState } from '@/components/storefront/error-state';

/**
 * Below the order layout, so the date picker and the in-memory cart and contact details stay
 * mounted while only the date's catalog is replaced.
 */
const PickupDateError = ({ error, retry }: { error: unknown; retry: () => void }) => (
    <ErrorState
        error={error}
        retry={retry}
        headingLevel="h2"
        heading="Nabídku se nepodařilo načíst"
        message="Nabídku na tento den se teď nepodařilo načíst. Košík vám zůstává, zkuste to prosím za chvíli znovu."
    />
);

export default PickupDateError;
