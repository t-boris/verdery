'use client';

import type { ClientEngagement } from '@verdery/api-contracts';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, StaleIndicator, StatusPill } from '@/shared/ui/public';

import styles from './garden-engagements-section.module.css';
import { isConcealedAccessFailure } from './garden-read-access';
import { engagementStateLabel, engagementStateTone } from './labels';
import { useGardenClientEngagementsForGarden } from './queries';

/**
 * Garden-side read of `GET /gardens/{gardenId}/engagements`:
 * `manageGarden`-gated, owner-only — unlike `GardenAssignmentsSection`, an
 * engagement names a service-organization relationship and stewardship
 * policy, the same business-sensitivity `listGardenInvitations` already
 * reserves to the owner alone (`listGardenClientEngagements`'s own
 * description).
 *
 * A non-owner ACTIVE member gets a real `auth.forbidden` (403) — genuine
 * membership, insufficient capability; a caller with no relationship to the
 * garden at all gets a concealed `garden.not_found` (404). Both render as
 * "nothing here" rather than an error alert: an editor or viewer opening
 * their own garden's settings page must not see a raw "Forbidden" banner
 * for a section that was never meant for their role in the first place,
 * the same "hide, don't error" posture `Collaborators` already takes for
 * `InviteForm`/`PendingInvitations` on a non-owner caller — except THAT
 * component can compute the gate client-side from a role it already knows,
 * while this one has no such signal of its own (it never fetches the
 * caller's own role) and instead lets the real 403/404 decide, the
 * server remaining authoritative either way.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listGardenClientEngagements`.
 */
export function GardenEngagementsSection({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const query = useGardenClientEngagementsForGarden(gardenId);

  if (query.isLoadingError && isConcealedAccessFailure(query.error.failure)) {
    return null;
  }

  return (
    <Card title={t('engagements.gardenSectionTitle')}>
      <p className={styles['description']}>{t('engagements.gardenSectionDescription')}</p>

      {query.isPending && <p role="status">{t('engagements.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('engagements.retry')}
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
          <p className={styles['empty']}>{t('engagements.gardenEmpty')}</p>
        ) : (
          <ul className={styles['list']}>
            {query.data.items.map((engagement) => (
              <GardenEngagementReadRow key={engagement.id} engagement={engagement} />
            ))}
          </ul>
        ))}
    </Card>
  );
}

function GardenEngagementReadRow({ engagement }: { readonly engagement: ClientEngagement }) {
  const { t } = useLocalization();

  return (
    <li className={styles['row']}>
      <span>{engagement.serviceOrganizationId ?? engagement.createdByProfileId}</span>
      <StatusPill
        tone={engagementStateTone(engagement.state)}
        label={t(engagementStateLabel(engagement.state))}
      />
    </li>
  );
}
