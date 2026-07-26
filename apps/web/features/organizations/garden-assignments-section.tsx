'use client';

import type { GardenAssignment } from '@verdery/api-contracts';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import styles from './garden-assignments-section.module.css';
import { isConcealedAccessFailure } from './garden-read-access';
import { assignmentRoleLabel, assignmentStateLabel, assignmentStateTone } from './labels';
import { useGardenAssignmentsForGarden } from './queries';

/**
 * Garden-side read of `GET /gardens/{gardenId}/assignments`: which
 * professionals, from which organization, can currently reach this garden
 * — `viewGarden`-gated, open to every active role (owner, editor, viewer
 * alike), the SAME `listGardenMembers` reasoning `Collaborators` already
 * applies: a household member who cannot see which outside professional
 * has access to their own garden has less visibility into it than a
 * stranger would.
 *
 * Purely read-only here: administering an assignment (end/revoke) is an
 * ORGANIZATION capability (`manageGardenAssignment`), never a garden one —
 * the garden's own owner has no server-side path to it regardless of what
 * this page might render, so no control is offered. Composed as a SIBLING
 * of `Collaborators` on the garden settings page, not nested inside it —
 * the same `GardenPhotoUpload`/`GardenPlanUpload` precedent.
 *
 * A caller with no visibility into this garden at all gets a concealed
 * `garden.not_found`; this section renders nothing rather than an error in
 * that case, the same way it would for any route the caller cannot reach.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listGardenAssignments`.
 */
export function GardenAssignmentsSection({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const query = useGardenAssignmentsForGarden(gardenId);

  if (query.isLoadingError && isConcealedAccessFailure(query.error.failure)) {
    return null;
  }

  return (
    <Card title={t('assignments.gardenSectionTitle')}>
      <p className={styles['description']}>{t('assignments.gardenSectionDescription')}</p>

      {query.isPending && <p role="status">{t('assignments.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('assignments.retry')}
          </Button>
        </div>
      )}

      {!query.isLoadingError && (
        <StaleIndicator failure={query.isError ? query.error.failure : null} />
      )}
      {query.isRefetchError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}

      {!query.isLoadingError &&
        query.data !== undefined &&
        (query.data.items.length === 0 ? (
          <p className={styles['empty']}>{t('assignments.gardenEmpty')}</p>
        ) : (
          <ul className={styles['list']}>
            {query.data.items.map((assignment) => (
              <GardenAssignmentReadRow key={assignment.id} assignment={assignment} />
            ))}
          </ul>
        ))}
    </Card>
  );
}

function GardenAssignmentReadRow({ assignment }: { readonly assignment: GardenAssignment }) {
  const { t } = useLocalization();

  return (
    <li className={styles['row']}>
      <span>
        {t('assignments.organizationIdLabel')}: {assignment.organizationId} ·{' '}
        {t('assignments.profileIdLabel')}: {assignment.profileId}
      </span>
      <StatusPill tone="neutral" label={t(assignmentRoleLabel(assignment.role))} />
      <StatusPill
        tone={assignmentStateTone(assignment.state)}
        label={t(assignmentStateLabel(assignment.state))}
      />
    </li>
  );
}
