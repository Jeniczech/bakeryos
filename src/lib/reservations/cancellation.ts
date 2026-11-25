/** What a failed customer cancellation tells the customer; the UI maps each kind to its copy. */
export type CancelFailureKind = 'CUTOFF_PASSED' | 'NOT_CANCELLABLE' | 'NOT_FOUND' | 'RETRY';

const FAILURE_KINDS_BY_CODE: Partial<Record<string, CancelFailureKind>> = {
    CUTOFF_PASSED: 'CUTOFF_PASSED',
    INVALID_TRANSITION: 'NOT_CANCELLABLE',
    FORBIDDEN: 'NOT_CANCELLABLE',
    RESERVATION_NOT_FOUND: 'NOT_FOUND',
};

/**
 * Classifies a failed `POST /api/reservations/manage/:token/cancel` by its Problem Details
 * `code` (`null` for a network error or an unreadable body). `refreshPage` is set when the
 * displayed reservation is out of date, so a refresh shows its current state.
 */
export const describeCancelFailure = (
    code: string | null,
): { kind: CancelFailureKind; refreshPage: boolean } => {
    const kind = (code && FAILURE_KINDS_BY_CODE[code]) || 'RETRY';
    return { kind, refreshPage: kind !== 'RETRY' };
};
