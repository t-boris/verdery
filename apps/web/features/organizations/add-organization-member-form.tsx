'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, Select, TextField } from '@/shared/ui/public';

import styles from './add-organization-member-form.module.css';
import { useAddOrganizationMember } from './queries';

const addMemberSchema = z.object({
  profileId: z.string().trim().min(1),
  role: z.enum(['organizationAdmin', 'professional']),
});

type AddMemberValues = z.infer<typeof addMemberSchema>;

const ROLE_OPTIONS = [
  { value: 'professional', labelKey: 'organizations.roleProfessional' },
  { value: 'organizationAdmin', labelKey: 'organizations.roleAdmin' },
] as const;

/**
 * Adds an EXISTING profile by id — `addOrganizationMember`'s own
 * description explains why there is no invitation flow here, unlike a
 * garden invitation or a future client invitation: an organization admin
 * already has an ordinary, authenticated relationship with the
 * professional they are adding. This app has no directory to look a
 * profile up by name or email, so the field is a raw profile ID typed by
 * hand — an honest reflection of the given interface, the same posture
 * `open-plant-by-id-form.tsx` and `plants.gardenAreaMapObjectIdLabel`
 * already take for a plant or map-object id known only from elsewhere.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `addOrganizationMember`.
 */
export function AddOrganizationMemberForm({ organizationId }: { readonly organizationId: string }) {
  const { t } = useLocalization();
  const mutation = useAddOrganizationMember(organizationId);

  const { register, handleSubmit, formState, reset } = useForm<AddMemberValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { profileId: '', role: 'professional' },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(
      { profileId: values.profileId, role: values.role },
      { onSuccess: () => reset() },
    );
  });

  return (
    <Card title={t('organizations.addMemberTitle')}>
      <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('organizations.addMemberProfileIdLabel')}
          error={
            formState.errors.profileId === undefined
              ? undefined
              : t('organizations.addMemberProfileIdRequired')
          }
          {...register('profileId')}
        />
        <p className={styles['hint']}>{t('organizations.addMemberProfileIdHint')}</p>
        <Select
          label={t('organizations.addMemberRoleLabel')}
          options={ROLE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          {...register('role')}
        />
        <Button type="submit" variant="primary" busy={mutation.isPending}>
          {t('organizations.addMemberSubmit')}
        </Button>
        {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      </form>
    </Card>
  );
}
