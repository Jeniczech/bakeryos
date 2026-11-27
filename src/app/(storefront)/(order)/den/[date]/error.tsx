'use client';

import { ErrorState } from '@/components/ui/error-state';

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
        message="Nabídku na tento den se teď nepodařilo načíst. Váš košík zůstane uložen, zkuste to prosím za chvíli znovu nebo vyberte jiný den."
    />
);

export default PickupDateError;
