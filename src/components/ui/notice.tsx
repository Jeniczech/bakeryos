type NoticeTone = 'info' | 'warning';

const TONE_CLASSES: Record<NoticeTone, string> = {
    info: 'border-amber-200 bg-white text-stone-700',
    warning: 'border-orange-300 bg-orange-50 text-orange-900',
};

export const Notice = ({
    tone = 'info',
    children,
}: {
    tone?: NoticeTone;
    children: React.ReactNode;
}) => (
    <p
        role={tone === 'warning' ? 'alert' : 'status'}
        className={`rounded-lg border px-4 py-3 ${TONE_CLASSES[tone]}`}
    >
        {children}
    </p>
);
