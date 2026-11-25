import { StoredConfirmation } from '@/components/storefront/reservation-confirmation';

/**
 * Outside the order layout, so leaving it (header link, back) shows the order page again, and
 * the confirmation, stored per tab, survives a reload.
 */
const ConfirmationPage = () => <StoredConfirmation />;

export default ConfirmationPage;
