import { CartColumns } from '@/components/storefront/cart-columns';
import { CartSummary } from '@/components/storefront/cart-summary';
import { Notice } from '@/components/ui/notice';

const OrderPage = () => (
    <CartColumns cart={<CartSummary catalog={{ status: 'noDate' }} />}>
        <Notice>Vyberte den vyzvednutí a ukážeme vám, co si můžete rezervovat.</Notice>
    </CartColumns>
);

export default OrderPage;
