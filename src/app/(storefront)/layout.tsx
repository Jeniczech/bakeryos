import { StorefrontFrame } from '@/components/storefront/storefront-frame';

const StorefrontLayout = ({ children }: LayoutProps<'/'>) => (
    <StorefrontFrame>{children}</StorefrontFrame>
);

export default StorefrontLayout;
