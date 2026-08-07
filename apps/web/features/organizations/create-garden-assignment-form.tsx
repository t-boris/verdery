'use client';

import type { GardenAssignmentRole } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, CommandSurface, FailureAlert, PlusIcon, TextField } from '@/shared/ui/public';

import styles from './create-garden-assignment-form.module.css';
import { useCreateGardenAssignment, useOrganizationMembers } from './queries';

const ROLE_OPTIONS = [
  { value: 'editor', labelKey: 'gardens.roleEditor' },
  { value: 'viewer', labelKey: 'gardens.roleViewer' },
] as const;

/**
 * Assigns one of the organization's own ACTIVE members to a garden id
 * entered by hand. `gardenId` is a raw text field, not a picker: this
 * endpoint accepts ANY existing garden id unconditionally (`createGarden
 * Assignment`'s own description — free-standing, not scoped by a prior
 * client engagement, and nothing here asks the garden's owner to have
 * approved it first), and this app has no directory of gardens outside the
 * caller's own membership to pick from in the first place. A raw-id field is
 * the honest reflection of the given interface — the same pattern
 * `open-plant-by-id-form.tsx` and `plants.gardenAreaMapObjectIdLabel`
 * already establish for a plant or map-object id known only from
 * elsewhere; the garden id here is expected to come from the garden's own
 * owner, out of band, exactly as an organization admin already has an
 * ordinary relationship with the professional they assign (`add
 * OrganizationMember`'s own reasoning).
 *
 * The member picker IS a real `<Select>`, unlike the garden id: the set of
 * eligible assignees is exactly this organization's own active membership,
 * already known from `useOrganizationMembers` (the SAME cache key
 * `organization-members.tsx` populates — no second network request in
 * practice).
 *
 * Source: packages/api-contracts/openapi.yaml, operation `createGardenAssignment`.
 */
export function CreateGardenAssignmentForm({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const { t } = useLocalization();
  const membersQuery = useOrganizationMembers(organizationId);
  const mutation = useCreateGardenAssignment(organizationId);

  const [profileId, setProfileId] = useState('');
  const [gardenId, setGardenId] = useState('');
  const [role, setRole] = useState<GardenAssignmentRole>('editor');

  const members = membersQuery.data?.items ?? [];

  const onSubmit = () => {
    if (profileId === '' || gardenId.trim() === '') {
      return;
    }
    mutation.mutate(
      { profileId, gardenId: gardenId.trim(), role },
      {
        onSuccess: () => {
          setGardenId('');
        },
      },
    );
  };

  if (members.length === 0) {
    return <p className={styles['empty']}>{t('assignments.noEligibleMembers')}</p>;
  }

  return (
    <CommandSurface className={styles['form']} onCommit={onSubmit}>
      <div className={styles['choiceField']}>
        <span>{t('assignments.memberLabel')}</span>
        <div className={styles['choices']}>
          {members.map((member) => (
            <button
              key={member.profileId}
              type="button"
              aria-pressed={profileId === member.profileId}
              onClick={() => setProfileId(member.profileId)}
            >
              {member.profileId}
            </button>
          ))}
        </div>
      </div>
      <div className={styles['commandRow']}>
        <TextField
          label={t('assignments.gardenIdLabel')}
          value={gardenId}
          onChange={(event) => setGardenId(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={profileId === '' || gardenId.trim() === ''}
          iconOnly
          aria-label={t('assignments.submit')}
          title={t('assignments.submit')}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className={styles['choiceField']}>
        <span>{t('assignments.roleLabel')}</span>
        <div className={styles['choices']}>
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={role === option.value}
              onClick={() => setRole(option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <p className={styles['hint']}>{t('assignments.gardenIdHint')}</p>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
