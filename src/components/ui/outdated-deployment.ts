import { unstable_isUnrecognizedActionError } from 'next/navigation';

/**
 * A page open across a deployment calls Server Action IDs the new build no longer has. Next
 * rejects the request before any action code runs, so nothing changed, and only a full reload
 * loads the current actions.
 */
export const isOutdatedDeploymentError = (error: unknown): boolean =>
    unstable_isUnrecognizedActionError(error);

export const OUTDATED_DEPLOYMENT_HEADING = 'Aplikace byla aktualizována';
export const OUTDATED_DEPLOYMENT_MESSAGE =
    'Aplikace byla mezitím aktualizována, takže se akce neprovedla. Obnovte stránku a zkuste to znovu.';
export const RELOAD_PAGE_LABEL = 'Obnovit stránku';

export const reloadPage = (): void => {
    window.location.reload();
};
