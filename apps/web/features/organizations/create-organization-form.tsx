'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, CommandSurface, FailureAlert, PlusIcon, TextField } from '@/shared/ui/public';

import styles from './create-organization-form.module.css';
import { useCreateOrganization } from './queries';

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

type CreateOrganizationValues = z.infer<typeof createOrganizationSchema>;

/**
 * Creates a service organization — name only, per
 * `CreateServiceOrganizationRequest`. Any authenticated profile may call
 * this (`createServiceOrganization`'s own description: an organization does
 * not exist yet for anyone to hold a role on, so no capability could gate
 * its own creation) and the caller becomes its first `organizationAdmin`
 * atomically, so a solo professional's very first step is exactly this one
 * form (ADR-0012: "a solo professional may start with an organization
 * containing one administrator").
 *
 * Source: implementation-plan.md work package P9B-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `createServiceOrganization`.
 */
export function CreateOrganizationForm() {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useCreateOrganization();

  const { register, handleSubmit, formState, reset } = useForm<CreateOrganizationValues>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values.name, {
      onSuccess: (organization) => {
        reset();
        router.push(`/application/organizations/${organization.id}`);
      },
    });
  });

  return (
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      <TextField
        label={t('organizations.createNameLabel')}
        maxLength={120}
        error={formState.errors.name === undefined ? undefined : t('organizations.nameRequired')}
        {...register('name')}
      />
      <Button
        type="submit"
        variant="primary"
        busy={mutation.isPending}
        iconOnly
        aria-label={t('organizations.createSubmit')}
        title={t('organizations.createSubmit')}
      >
        <PlusIcon />
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
