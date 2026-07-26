'use client';

import type { OrganizationMember, OrganizationRole } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, StatusPill } from '@/shared/ui/public';

import { organizationRoleLabel } from './labels';
import styles from './organization-member-row.module.css';
import { useChangeOrganizationMemberRole, useRemoveOrganizationMember } from './queries';

export interface OrganizationMemberRowProps {
  readonly organizationId: string;
  readonly member: OrganizationMember;
  /** Whether the SIGNED-IN caller holds `manageOrganizationMembership` — never `member.role` itself. */
  readonly callerIsAdmin: boolean;
}

const ROLE_OPTIONS = [
  { value: 'organizationAdmin', labelKey: 'organizations.roleAdmin' },
  { value: 'professional', labelKey: 'organizations.roleProfessional' },
] as const;

/**
 * One active organization member and, for an admin caller only, the two
 * commands the contract allows against them: change role
 * (`organizationAdmin` ↔ `professional`) and remove. Both use
 * `globalThis.confirm` first — the same convention `member-row.tsx` already
 * uses for an irreversible command affecting someone else's access.
 *
 * Removing, or demoting, the organization's LAST active `organizationAdmin`
 * is refused by the server with a real `422`
 * (`organization.membership.last_admin_required`) — this row does not
 * duplicate that invariant client-side beyond disabling the obviously
 * doomed "save role" action once this member is already the role being
 * requested; any other case (including the actual last-admin one) is left
 * to the real error, rendered here exactly like any other mutation failure.
 *
 * There is no display name in `OrganizationMember` (only `profileId`,
 * `role`, `state`, and timestamps), so this row shows the raw account id —
 * the same honest fallback `member-row.tsx` already uses for
 * `GardenMember`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`.
 */
export function OrganizationMemberRow({
  organizationId,
  member,
  callerIsAdmin,
}: OrganizationMemberRowProps) {
  const { t } = useLocalization();
  const [pendingRole, setPendingRole] = useState<OrganizationRole>(member.role);

  const changeRoleMutation = useChangeOrganizationMemberRole(organizationId);
  const removeMutation = useRemoveOrganizationMember(organizationId);

  const onChangeRole = () => {
    if (
      globalThis.confirm(
        t('organizations.changeRoleConfirm', { role: t(organizationRoleLabel(pendingRole)) }),
      )
    ) {
      changeRoleMutation.mutate({ profileId: member.profileId, role: pendingRole });
    }
  };

  const onRemove = () => {
    if (globalThis.confirm(t('organizations.removeConfirm'))) {
      removeMutation.mutate(member.profileId);
    }
  };

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['identity']}>{member.profileId}</span>
        <StatusPill tone="neutral" label={t(organizationRoleLabel(member.role))} />
      </div>

      {callerIsAdmin && (
        <div className={styles['actions']}>
          <Select
            label={t('organizations.changeRoleLabel')}
            options={ROLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            value={pendingRole}
            onChange={(event) => setPendingRole(event.target.value as OrganizationRole)}
          />
          <Button
            variant="secondary"
            busy={changeRoleMutation.isPending}
            disabled={pendingRole === member.role}
            onClick={onChangeRole}
          >
            {t('organizations.changeRoleSave')}
          </Button>
          <Button variant="destructive" busy={removeMutation.isPending} onClick={onRemove}>
            {t('organizations.remove')}
          </Button>
        </div>
      )}

      {changeRoleMutation.isError && <FailureAlert failure={changeRoleMutation.error.failure} />}
      {removeMutation.isError && <FailureAlert failure={removeMutation.error.failure} />}
    </li>
  );
}
