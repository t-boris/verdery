'use client';

import { useState, type FormEvent } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert, TextField } from '@/shared/ui/public';

import styles from './create-client-engagement-form.module.css';
import { useCreateClientEngagement } from './queries';

/**
 * Creates a `draft` client engagement for a garden id entered by hand —
 * the same honest raw-id posture `create-garden-assignment-form.tsx`
 * documents, for the identical reason: `createClientEngagement` accepts any
 * existing garden id unconditionally when a service organization is named
 * (`createClientEngagement`'s own description — free-standing, nothing
 * requires the garden owner to have done anything first), and this app has
 * no directory of gardens outside the caller's own membership.
 *
 * `stewardshipPolicy` and `clientNotificationsEnabled` are left at their
 * contract defaults (`residential`, `true`) rather than exposed as form
 * fields: `residential` is the only value the database currently admits, so
 * a picker with one disabled option would be a control that cannot
 * actually control anything.
 *
 * Activation is a deliberately separate step (`activateClientEngagement`),
 * not folded into this form — `organization-client-engagement-row.tsx`
 * offers it once the draft exists.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `createClientEngagement`.
 */
export function CreateClientEngagementForm({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const { t } = useLocalization();
  const mutation = useCreateClientEngagement(organizationId);
  const [gardenId, setGardenId] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = gardenId.trim();
    if (trimmed === '') {
      return;
    }
    mutation.mutate(trimmed, { onSuccess: () => setGardenId('') });
  };

  return (
    <Card title={t('engagements.createTitle')}>
      <form className={styles['form']} onSubmit={onSubmit} noValidate>
        <TextField
          label={t('engagements.gardenIdLabel')}
          value={gardenId}
          onChange={(event) => setGardenId(event.target.value)}
        />
        <p className={styles['hint']}>{t('engagements.gardenIdHint')}</p>
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          disabled={gardenId.trim() === ''}
        >
          {t('engagements.submit')}
        </Button>
        {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      </form>
    </Card>
  );
}
