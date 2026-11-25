import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Administrace – BakeryOS',
    robots: { index: false, follow: false },
};

const AdminLayout = ({ children }: LayoutProps<'/admin'>) => (
    <div className="flex flex-1 flex-col bg-stone-50 text-stone-900">{children}</div>
);

export default AdminLayout;
