'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import {
  ActionDisclosure,
  Button,
  Card,
  FailureAlert,
  MapIcon,
  StaleIndicator,
} from '@/shared/ui/public';

import { CreateGardenAssignmentForm } from './create-garden-assignment-form';
import styles from './organization-members.module.css';
import { OrganizationGardenAssignmentRow } from './organization-garden-assignment-row';
import { useOrganization, useOrganizationGardenAssignments } from './queries';

export interface OrganizationGardenAssignmentsProps {
  readonly organizationId: string;
}

/**
 * "Which gardens does this organization's members work on" — from the
 * organization's own side (`listOrganizationGardenAssignments`, any active
 * member may read), with creation and end/revoke reserved to an
 * `organizationAdmin` caller (`manageGardenAssignment`). The garden's own
 * mirror view — "who can reach this garden" — is
 * `garden-assignments-section.tsx`, composed onto the garden settings page
 * instead.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `listOrganizationGardenAssignments`.
 */
export function OrganizationGardenAssignments({
  organizationId,
}: OrganizationGardenAssignmentsProps) {
  const { t } = useLocalization();
  const roleQuery = useOrganization(organizationId);
  const assignmentsQuery = useOrganizationGardenAssignments(organizationId);

  const callerIsAdmin = roleQuery.data?.callerRole === 'organizationAdmin';

  return (
    <div className={styles['list']}>
      <Card title={t('assignments.orgSectionTitle')}>
        {assignmentsQuery.isPending && <p role="status">{t('assignments.loading')}</p>}

        {assignmentsQuery.isLoadingError && (
          <div className={styles['errorState']}>
            <FailureAlert failure={assignmentsQuery.error.failure} />
            <Button variant="secondary" onClick={() => void assignmentsQuery.refetch()}>
              {t('assignments.retry')}
            </Button>
          </div>
        )}

        {!assignmentsQuery.isLoadingError && (
          <StaleIndicator
            failure={assignmentsQuery.isError ? assignmentsQuery.error.failure : null}
          />
        )}
        {assignmentsQuery.isRefetchError &&
          !isConnectivityFailure(assignmentsQuery.error.failure) && (
            <FailureAlert failure={assignmentsQuery.error.failure} />
          )}

        {!assignmentsQuery.isLoadingError &&
          assignmentsQuery.data !== undefined &&
          (assignmentsQuery.data.items.length === 0 ? (
            <p className={styles['notice']}>{t('assignments.empty')}</p>
          ) : (
            <ul className={styles['list']}>
              {assignmentsQuery.data.items.map((assignment) => (
                <OrganizationGardenAssignmentRow
                  key={assignment.id}
                  organizationId={organizationId}
                  assignment={assignment}
                  callerIsAdmin={callerIsAdmin}
                />
              ))}
            </ul>
          ))}
      </Card>

      {callerIsAdmin && (
        <ActionDisclosure title={t('assignments.createTitle')} icon={<MapIcon />}>
          <CreateGardenAssignmentForm organizationId={organizationId} />
        </ActionDisclosure>
      )}
    </div>
  );
}
