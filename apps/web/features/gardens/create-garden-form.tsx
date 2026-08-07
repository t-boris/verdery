'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import {
  Button,
  CommandSurface,
  FailureAlert,
  PlusIcon,
  SparklesIcon,
  SproutIcon,
} from '@/shared/ui/public';

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

  const { register, handleSubmit, formState, reset, setValue } = useForm<CreateGardenValues>({
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
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      <div className={styles['composer']}>
        <span className={styles['composerIcon']}>
          <SproutIcon size={20} />
        </span>
        <input
          className={styles['input']}
          aria-label={t('gardens.createNameLabel')}
          aria-invalid={formState.errors.name === undefined ? undefined : true}
          placeholder={t('gardens.createNamePlaceholder')}
          maxLength={120}
          {...register('name')}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          iconOnly
          aria-label={t('gardens.createSubmit')}
          title={t('gardens.createSubmit')}
        >
          <PlusIcon size={18} />
        </Button>
      </div>

      {formState.errors.name !== undefined && (
        <p className={styles['error']}>{t('gardens.nameRequired')}</p>
      )}

      <div className={styles['suggestions']}>
        <span className={styles['suggestionsLabel']}>
          <SparklesIcon size={14} />
          {t('gardens.nameSuggestions')}
        </span>
        <div className={styles['suggestionList']}>
          {(
            [
              'gardens.nameSuggestionHome',
              'gardens.nameSuggestionBackyard',
              'gardens.nameSuggestionCommunity',
            ] as const
          ).map((messageKey) => (
            <button
              className={styles['suggestion']}
              type="button"
              key={messageKey}
              onClick={() => {
                setValue('name', t(messageKey), { shouldDirty: true, shouldValidate: true });
              }}
            >
              {t(messageKey)}
            </button>
          ))}
        </div>
      </div>

      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
