'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateInvitationResult } from '@verdery/api-contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, Card, FailureAlert, Select, TextField } from '@/shared/ui/public';

import { useCreateInvitation } from './queries';
import styles from './invite-form.module.css';

const inviteSchema = z.object({
  intendedRole: z.enum(['editor', 'viewer']),
  intendedEmail: z.union([z.email(), z.literal('')]),
});

type InviteValues = z.infer<typeof inviteSchema>;

const ROLE_OPTIONS = [
  { value: 'editor', labelKey: 'gardens.roleEditor' },
  { value: 'viewer', labelKey: 'gardens.roleViewer' },
] as const;

function invitationLink(token: string): string {
  return `${globalThis.location.origin}/invite/accept?token=${encodeURIComponent(token)}`;
}

/**
 * Creates an ordinary invitation (editor or viewer only — an invitation can
 * never name `owner`, by construction) and reveals its one-time raw token
 * as a copyable link. The token is present ONLY in the create response; the
 * server stores only its hash, so once this panel is dismissed the link
 * cannot be recovered and a new invitation must be issued instead.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `createInvitation`.
 */
export function InviteForm({ gardenId }: { readonly gardenId: string }) {
  const { t } = useLocalization();
  const mutation = useCreateInvitation(gardenId);
  const [created, setCreated] = useState<CreateInvitationResult | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const { register, handleSubmit, formState, reset } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { intendedRole: 'editor', intendedEmail: '' },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(
      {
        intendedRole: values.intendedRole,
        ...(values.intendedEmail === '' ? {} : { intendedEmail: values.intendedEmail }),
      },
      { onSuccess: (result) => setCreated(result) },
    );
  });

  const onCopy = async () => {
    if (created === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(invitationLink(created.token));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const onDone = () => {
    setCreated(null);
    setCopyState('idle');
    reset();
  };

  if (created !== null) {
    return (
      <Card title={t('invitations.createdTitle')}>
        <Alert tone="info" title={t('invitations.createdTitle')}>
          <p>{t('invitations.createdDescription')}</p>
        </Alert>
        <TextField
          label={t('invitations.linkLabel')}
          value={invitationLink(created.token)}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className={styles['actions']}>
          <Button variant="secondary" onClick={() => void onCopy()}>
            {t('invitations.copy')}
          </Button>
          <Button variant="primary" onClick={onDone}>
            {t('invitations.done')}
          </Button>
        </div>
        {copyState === 'copied' && <p role="status">{t('invitations.copied')}</p>}
        {copyState === 'failed' && <p role="status">{t('invitations.copyFailed')}</p>}
      </Card>
    );
  }

  return (
    <Card title={t('invitations.inviteTitle')}>
      <form className={styles['form']} onSubmit={(event) => void onSubmit(event)} noValidate>
        <Select
          label={t('invitations.roleLabel')}
          options={ROLE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          {...register('intendedRole')}
        />
        <TextField
          label={t('invitations.emailLabel')}
          type="email"
          autoComplete="email"
          error={formState.errors.intendedEmail === undefined ? undefined : t('auth.emailInvalid')}
          {...register('intendedEmail')}
        />
        <p className={styles['hint']}>{t('invitations.emailHint')}</p>
        <Button type="submit" variant="primary" busy={mutation.isPending}>
          {t('invitations.submit')}
        </Button>
        {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
      </form>
    </Card>
  );
}
