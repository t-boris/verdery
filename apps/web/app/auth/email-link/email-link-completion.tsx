'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from '@/shared/validation/zod';

import {
  ApiFailureError,
  createBrowserApiClient,
  createSessionGateway,
  isFailure,
} from '@/core/api/public';
import {
  completeEmailSignIn,
  isSignInWithEmailLink,
  pendingEmailForSignIn,
} from '@/core/auth/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, CommandSurface, TextField } from '@/shared/ui/public';

import styles from './email-link-completion.module.css';

type State = 'working' | 'needsEmail' | 'error';

const emailSchema = z.object({ email: z.email() });
type EmailValues = z.infer<typeof emailSchema>;

/** A relative path only — never an absolute URL a crafted `next` value could turn into an off-app redirect. */
function isSafeRelativePath(next: string): boolean {
  return next.startsWith('/') && !next.startsWith('//');
}

/**
 * Completes an email magic-link sign-in.
 *
 * `pendingEmailForSignIn` is empty when the link is opened somewhere other
 * than where it was requested — a different browser or device — which
 * Firebase's own documented pattern resolves by asking the user to confirm
 * their address again, not by failing outright.
 *
 * `next` rides in this same link's own query string — `sendEmailSignInLink`
 * embeds it in the continue URL Firebase appends its own parameters to, so
 * it survives the round trip through the user's inbox. Without this, every
 * caller of `sendEmailSignInLink` (sign-in requested from an invitation
 * page, from the client portal, from anywhere but a bare sign-in) would
 * land back on the gardens list instead of wherever they were actually
 * trying to go — silently dropping, for example, an invitation token this
 * same page never saw.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "3. Initial Sign-In Methods".
 */
export function EmailLinkCompletion() {
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>('working');

  const { register, handleSubmit, formState } = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  async function complete(email: string) {
    setState('working');
    try {
      const idToken = await completeEmailSignIn(email, globalThis.location.href);
      const result = await createSessionGateway(createBrowserApiClient()).createSession(idToken);
      if (isFailure(result)) {
        throw new ApiFailureError(result);
      }
      const next = searchParams.get('next');
      router.push(next !== null && isSafeRelativePath(next) ? next : '/application/gardens');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    const link = globalThis.location.href;

    if (!isSignInWithEmailLink(link)) {
      setState('error');
      return;
    }

    const storedEmail = pendingEmailForSignIn();
    if (storedEmail === null) {
      setState('needsEmail');
      return;
    }

    void complete(storedEmail);
    // Runs once, against the URL present on first render.
  }, []);

  if (state === 'working') {
    return <p role="status">{t('auth.completingSignIn')}</p>;
  }

  if (state === 'needsEmail') {
    return (
      <CommandSurface
        className={styles['form']}
        onCommit={() => void handleSubmit((values) => complete(values.email))()}
      >
        <p>{t('auth.emailLinkConfirmDescription')}</p>
        <TextField
          label={t('auth.emailLabel')}
          type="email"
          autoComplete="email"
          error={formState.errors.email === undefined ? undefined : t('auth.signInFailed')}
          {...register('email')}
        />
        <Button type="submit" variant="primary" busy={formState.isSubmitting}>
          {t('auth.emailSubmit')}
        </Button>
      </CommandSurface>
    );
  }

  return (
    <Alert tone="danger" title={t('auth.signInFailed')}>
      <p>{t('auth.emailLinkInvalid')}</p>
    </Alert>
  );
}
