'use client';

import type { GardenMember } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, Select, StatusPill } from '@/shared/ui/public';

import { roleLabel } from './labels';
import styles from './member-row.module.css';
import { useChangeMemberRole, useRemoveMember } from './queries';
import { useDemoteMember, usePromoteMember } from './ownership-queries';

export interface MemberRowProps {
  readonly gardenId: string;
  readonly member: GardenMember;
  /** Whether the SIGNED-IN caller is an owner — never `member.role` itself. */
  readonly callerIsOwner: boolean;
}

const CHANGEABLE_ROLE_OPTIONS = [
  { value: 'editor', labelKey: 'gardens.roleEditor' },
  { value: 'viewer', labelKey: 'gardens.roleViewer' },
] as const;

/**
 * One active member and, for an owner caller only, every role-administration
 * command the contract allows against them: change role (editor ↔ viewer),
 * promote to co-owner, demote from owner, and remove. Every one of these
 * uses `globalThis.confirm` before mutating — the same convention
 * `garden-settings.tsx` and `task-row.tsx` already use for an irreversible
 * command — because each affects someone else's access, not the caller's
 * own.
 *
 * There is no display name in `GardenMember` at all (only `profileId`,
 * `role`, `state`, and timestamps — checked directly against
 * `packages/api-contracts/openapi.yaml`'s schema): this row shows the raw
 * account id as the honest fallback rather than inventing a name the
 * contract does not provide.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * docs/development/garden-capability-matrix.md, section "4.8 Membership".
 */
export function MemberRow({ gardenId, member, callerIsOwner }: MemberRowProps) {
  const { t } = useLocalization();
  const [pendingRole, setPendingRole] = useState<'editor' | 'viewer'>(
    member.role === 'viewer' ? 'viewer' : 'editor',
  );
  const [demoteRole, setDemoteRole] = useState<'editor' | 'viewer'>('editor');

  const changeRoleMutation = useChangeMemberRole(gardenId);
  const promoteMutation = usePromoteMember(gardenId);
  const demoteMutation = useDemoteMember(gardenId);
  const removeMutation = useRemoveMember(gardenId);

  const onChangeRole = () => {
    if (
      globalThis.confirm(t('collaborators.changeRoleConfirm', { role: t(roleLabel(pendingRole)) }))
    ) {
      changeRoleMutation.mutate({ profileId: member.profileId, role: pendingRole });
    }
  };

  const onPromote = () => {
    if (globalThis.confirm(t('collaborators.promoteConfirm'))) {
      promoteMutation.mutate(member.profileId);
    }
  };

  const onDemote = () => {
    if (globalThis.confirm(t('collaborators.demoteConfirm', { role: t(roleLabel(demoteRole)) }))) {
      demoteMutation.mutate({ profileId: member.profileId, role: demoteRole });
    }
  };

  const onRemove = () => {
    if (globalThis.confirm(t('collaborators.removeConfirm'))) {
      removeMutation.mutate(member.profileId);
    }
  };

  return (
    <li className={styles['row']}>
      <div className={styles['header']}>
        <span className={styles['identity']}>{member.profileId}</span>
        <StatusPill tone="neutral" label={t(roleLabel(member.role))} />
      </div>

      {callerIsOwner && (
        <div className={styles['actions']}>
          {member.role !== 'owner' && (
            <div className={styles['roleChange']}>
              <Select
                label={t('collaborators.changeRoleLabel')}
                options={CHANGEABLE_ROLE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
                value={pendingRole}
                onChange={(event) => setPendingRole(event.target.value as 'editor' | 'viewer')}
              />
              <Button
                variant="secondary"
                busy={changeRoleMutation.isPending}
                disabled={pendingRole === member.role}
                onClick={onChangeRole}
              >
                {t('collaborators.changeRoleSave')}
              </Button>
              <Button variant="secondary" busy={promoteMutation.isPending} onClick={onPromote}>
                {t('collaborators.promote')}
              </Button>
            </div>
          )}

          {member.role === 'owner' && (
            <div className={styles['roleChange']}>
              <Select
                label={t('collaborators.demoteRoleLabel')}
                options={CHANGEABLE_ROLE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
                value={demoteRole}
                onChange={(event) => setDemoteRole(event.target.value as 'editor' | 'viewer')}
              />
              <Button variant="secondary" busy={demoteMutation.isPending} onClick={onDemote}>
                {t('collaborators.demote')}
              </Button>
            </div>
          )}

          <Button variant="destructive" busy={removeMutation.isPending} onClick={onRemove}>
            {t('collaborators.remove')}
          </Button>
        </div>
      )}

      {changeRoleMutation.isError && <FailureAlert failure={changeRoleMutation.error.failure} />}
      {promoteMutation.isError && <FailureAlert failure={promoteMutation.error.failure} />}
      {demoteMutation.isError && <FailureAlert failure={demoteMutation.error.failure} />}
      {removeMutation.isError && <FailureAlert failure={removeMutation.error.failure} />}
    </li>
  );
}
