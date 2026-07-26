'use client';

import type { GardenAssignmentRole } from '@verdery/api-contracts';
import { useState, type FormEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, Select, TextField } from '@/shared/ui/public';

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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
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

  return (
    <Card title={t('assignments.createTitle')}>
      {members.length === 0 ? (
        <p className={styles['empty']}>{t('assignments.noEligibleMembers')}</p>
      ) : (
        <form className={styles['form']} onSubmit={onSubmit} noValidate>
          <Select
            label={t('assignments.memberLabel')}
            options={[
              { value: '', label: t('assignments.memberPlaceholder') },
              ...members.map((member) => ({ value: member.profileId, label: member.profileId })),
            ]}
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          />
          <TextField
            label={t('assignments.gardenIdLabel')}
            value={gardenId}
            onChange={(event) => setGardenId(event.target.value)}
          />
          <p className={styles['hint']}>{t('assignments.gardenIdHint')}</p>
          <Select
            label={t('assignments.roleLabel')}
            options={ROLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            value={role}
            onChange={(event) => setRole(event.target.value as GardenAssignmentRole)}
          />
          <Button
            type="submit"
            variant="primary"
            busy={mutation.isPending}
            disabled={profileId === '' || gardenId.trim() === ''}
          >
            {t('assignments.submit')}
          </Button>
          {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
        </form>
      )}
    </Card>
  );
}
