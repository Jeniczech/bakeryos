import { Notice } from './notice';

/** A Suspense fallback that appears only if loading takes longer than a moment. */
export const LoadingNotice = ({ children }: { children: React.ReactNode }) => (
    <div className="animate-delayed-fade-in">
        <Notice>{children}</Notice>
    </div>
);
