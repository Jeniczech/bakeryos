import { Suspense } from 'react';
import { requireAdmin } from '@/server/auth/require-admin';

// Placeholder until the reservation list (Stage 6b); it already guards itself.
const ReservationsContent = async () => {
    await requireAdmin();
    return <p className="text-stone-600">Seznam rezervací bude doplněn.</p>;
};

const ReservationsPage = () => (
    <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-950">Rezervace</h1>
        <Suspense fallback={null}>
            <ReservationsContent />
        </Suspense>
    </section>
);

export default ReservationsPage;
