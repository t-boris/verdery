'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { Alert, Button, TextField } from '@/shared/ui/public';

import styles from './email-link-completion.module.css';

type State = 'working' | 'needsEmail' | 'error';

const emailSchema = z.object({ email: z.email() });
type EmailValues = z.infer<typeof emailSchema>;

/**
 * Completes an email magic-link sign-in.
 *
 * `pendingEmailForSignIn` is empty when the link is opened somewhere other
 * than where it was requested — a different browser or device — which
 * Firebase's own documented pattern resolves by asking the user to confirm
 * their address again, not by failing outright.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "3. Initial Sign-In Methods".
 */
export function EmailLinkCompletion() {
  const { t } = useLocalization();
  const router = useRouter();
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
      router.push('/application/gardens');
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
      <form
        className={styles['form']}
        onSubmit={(event) => void handleSubmit((values) => complete(values.email))(event)}
        noValidate
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
      </form>
    );
  }

  return (
    <Alert tone="danger" title={t('auth.signInFailed')}>
      <p>{t('auth.emailLinkInvalid')}</p>
    </Alert>
  );
}
