'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, TextField } from '@/shared/ui/public';

import { useCreateGarden } from './queries';
import styles from './create-garden-form.module.css';

const createGardenSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

type CreateGardenValues = z.infer<typeof createGardenSchema>;

/**
 * Validates client-side with the same bounds the contract declares
 * (`CreateGardenRequest.name`), purely to preserve the user's input on an
 * obvious mistake before a round trip — the server remains authoritative.
 *
 * Source: architecture/web-application-design.md, section "11. Forms and Validation".
 */
export function CreateGardenForm() {
  const { t } = useLocalization();
  const router = useRouter();
  const mutation = useCreateGarden();

  const { register, handleSubmit, formState, reset } = useForm<CreateGardenValues>({
    resolver: zodResolver(createGardenSchema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values.name, {
      onSuccess: (garden) => {
        reset();
        router.push(`/application/gardens/${garden.id}`);
      },
    });
  });

  return (
    <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
      <TextField
        label={t('gardens.createNameLabel')}
        maxLength={120}
        error={formState.errors.name === undefined ? undefined : t('gardens.nameRequired')}
        {...register('name')}
      />
      <Button type="submit" variant="primary" busy={mutation.isPending}>
        {t('gardens.createSubmit')}
      </Button>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </form>
  );
}
