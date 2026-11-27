import { CartColumns } from '@/components/storefront/cart-columns';
import { CartSummary } from '@/components/storefront/cart-summary';
import { CheckoutButton } from '@/components/storefront/checkout-button';
import { Notice } from '@/components/ui/notice';

const OrderPage = () => (
    <CartColumns
        cart={<CartSummary catalog={{ status: 'noDate' }} pickupDate={null} />}
        checkout={<CheckoutButton catalog={{ status: 'noDate' }} pickupDate={null} />}
    >
        <Notice>Vyberte si den vyzvednutí a prohlédněte si nabídku pečiva.</Notice>
    </CartColumns>
);

export default OrderPage;
