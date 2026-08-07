'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateInvitationResult } from '@verdery/api-contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import { useLocalization } from '@/shared/localization/public';
import {
  Alert,
  Button,
  CommandSurface,
  FailureAlert,
  PlusIcon,
  TextField,
} from '@/shared/ui/public';

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

  const { register, handleSubmit, formState, reset, setValue, watch } = useForm<InviteValues>({
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
      <div className={styles['result']}>
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
      </div>
    );
  }

  const selectedRole = watch('intendedRole');

  return (
    <CommandSurface className={styles['form']} onCommit={() => void onSubmit()}>
      <div className={styles['roles']} aria-label={t('invitations.roleLabel')}>
        {ROLE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selectedRole === option.value}
            onClick={() => setValue('intendedRole', option.value, { shouldDirty: true })}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <div className={styles['commandRow']}>
        <TextField
          label={t('invitations.emailLabel')}
          type="email"
          autoComplete="email"
          error={formState.errors.intendedEmail === undefined ? undefined : t('auth.emailInvalid')}
          {...register('intendedEmail')}
        />
        <Button
          type="submit"
          variant="primary"
          busy={mutation.isPending}
          iconOnly
          aria-label={t('invitations.submit')}
          title={t('invitations.submit')}
        >
          <PlusIcon />
        </Button>
      </div>
      <p className={styles['hint']}>{t('invitations.emailHint')}</p>
      {mutation.isError && <FailureAlert failure={mutation.error.failure} />}
    </CommandSurface>
  );
}
