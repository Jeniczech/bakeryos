import Link from 'next/link';

const StorefrontLayout = ({ children }: LayoutProps<'/'>) => (
    <div className="flex flex-1 flex-col bg-amber-50 text-stone-900">
        <header className="border-b border-amber-200 bg-amber-100/60">
            <div className="mx-auto flex max-w-4xl items-center px-4 py-4">
                <Link href="/" className="text-xl font-semibold tracking-tight text-amber-900">
                    BakeryOS
                </Link>
            </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">{children}</main>
    </div>
);

export default StorefrontLayout;
