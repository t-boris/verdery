'use client';

import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, CommandSurface, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './create-client-update-form.module.css';
import { useCreateClientUpdate } from './queries';

/**
 * Starts a new client update in `internal_draft`, titled by hand — content
 * (`summary`), items, and every lifecycle transition are all separate later
 * steps, the same "create is the smallest possible first step" posture
 * `create-client-engagement-form.tsx` documents for its own sibling
 * resource.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `createClientUpdate`.
 */
export function CreateClientUpdateForm({ engagementId }: { readonly engagementId: string }) {
  const { t } = useLocalization();
  const mutation = useCreateClientUpdate(engagementId);
  const [title, setTitle] = useState('');

  const onSubmit = () => {
    const trimmed = title.trim();
    if (trimmed === '') {
      return;
    }
    mutation.mutate(trimmed, { onSuccess: () => setTitle('') });
  };

  return (
    <Card title={t('publications.createTitle')}>
      <CommandSurface className={styles['form']} onCommit={onSubmit}>
        <TextField
          label={t('publications.createTitleLabel')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={title.trim() === ''}
        >
          {t('publications.createSubmit')}
        </Button>
        {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      </CommandSurface>
    </Card>
  );
}
