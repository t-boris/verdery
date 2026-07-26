'use client';

import type { GardenAssignment } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import { assignmentRoleLabel, assignmentStateLabel, assignmentStateTone } from './labels';
import styles from './organization-member-row.module.css';
import { useEndGardenAssignment, useRevokeGardenAssignment } from './queries';

/**
 * One garden assignment from the organization's own view: which member,
 * which garden, which role, and its current state — plus, for an
 * `organizationAdmin` caller only, while the assignment is active, end/
 * revoke (`manageGardenAssignment`). Both are idempotent server-side but
 * mutually exclusive terminal states (`GardenAssignmentState`'s own
 * diagram), so only the active row offers either control at all, and only
 * to a caller who could actually use it — the same `callerIsOwner`-gated
 * posture `member-row.tsx` already takes for its own admin-only controls.
 *
 * `listOrganizationGardenAssignments`'s own description ("List an
 * organization's ACTIVE garden assignments") means every row this
 * component ever actually receives is `state: 'active'` in practice — once
 * ended or revoked, an assignment drops out of the list entirely rather
 * than staying visible with a terminal-state badge (unlike a client
 * engagement, whose list endpoint explicitly returns every state). The
 * `state !== 'active'` branches below are kept anyway, for the same
 * defensive-completeness reason `assignmentStateLabel`/`assignmentStateTone`
 * still cover all three `GardenAssignmentState` values rather than only the
 * one this endpoint currently returns.
 *
 * Source: packages/api-contracts/openapi.yaml, operations `listOrganizationGardenAssignments`, `endGardenAssignment`, `revokeGardenAssignment`.
 */
export function OrganizationGardenAssignmentRow({
  organizationId,
  assignment,
  callerIsAdmin,
}: {
  readonly organizationId: string;
  readonly assignment: GardenAssignment;
  /** Whether the SIGNED-IN caller holds `manageGardenAssignment` — never the assignment's own fields. */
  readonly callerIsAdmin: boolean;
}) {
  const { t } = useLocalization();
  const endMutation = useEndGardenAssignment(organizationId);
  const revokeMutation = useRevokeGardenAssignment(organizationId);

  const onEnd = () => {
    if (globalThis.confirm(t('assignments.endConfirm'))) {
      endMutation.mutate(assignment.id);
    }
  };

  const onRevoke = () => {
    if (globalThis.confirm(t('assignments.revokeConfirm'))) {
      revokeMutation.mutate(assignment.id);
    }
  };

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['identity']}>
          {assignment.profileId} → {assignment.gardenId}
        </span>
        <StatusPill tone="neutral" label={t(assignmentRoleLabel(assignment.role))} />
        <StatusPill
          tone={assignmentStateTone(assignment.state)}
          label={t(assignmentStateLabel(assignment.state))}
        />
      </div>

      {callerIsAdmin && assignment.state === 'active' && (
        <div className={styles['actions']}>
          <Button variant="secondary" busy={endMutation.isPending} onClick={onEnd}>
            {t('assignments.end')}
          </Button>
          <Button variant="destructive" busy={revokeMutation.isPending} onClick={onRevoke}>
            {t('assignments.revoke')}
          </Button>
        </div>
      )}

      {endMutation.isError && <FailureAlert failure={endMutation.error.failure} />}
      {revokeMutation.isError && <FailureAlert failure={revokeMutation.error.failure} />}
    </li>
  );
}
