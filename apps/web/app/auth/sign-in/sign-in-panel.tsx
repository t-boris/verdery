'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  ApiFailureError,
  createBrowserApiClient,
  createSessionGateway,
  isFailure,
} from '@/core/api/public';
import { sendEmailSignInLink, signInWithApple, signInWithGoogle } from '@/core/auth/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, TextField } from '@/shared/ui/public';

import styles from './sign-in-panel.module.css';

const emailSchema = z.object({ email: z.email() });
type EmailValues = z.infer<typeof emailSchema>;

/**
 * Google and Apple popup sign-in, plus email magic-link request.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "3. Initial Sign-In Methods".
 */
export function SignInPanel() {
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const [applePending, setApplePending] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const { register, handleSubmit, formState } = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  async function completeSignIn(idToken: string) {
    const result = await createSessionGateway(createBrowserApiClient()).createSession(idToken);
    if (isFailure(result)) {
      throw new ApiFailureError(result);
    }
    const next = searchParams.get('next') ?? '/application/gardens';
    router.push(next);
  }

  const onGoogleSignIn = async () => {
    setGooglePending(true);
    setGoogleError(null);
    try {
      const idToken = await signInWithGoogle();
      await completeSignIn(idToken);
    } catch {
      setGoogleError(t('auth.signInFailed'));
      setGooglePending(false);
    }
  };

  const onAppleSignIn = async () => {
    setApplePending(true);
    setAppleError(null);
    try {
      const idToken = await signInWithApple();
      await completeSignIn(idToken);
    } catch {
      setAppleError(t('auth.signInFailed'));
      setApplePending(false);
    }
  };

  const onEmailSubmit = handleSubmit(async (values) => {
    setEmailError(null);
    try {
      await sendEmailSignInLink(values.email);
      setLinkSent(true);
    } catch {
      setEmailError(t('auth.signInFailed'));
    }
  });

  return (
    <div className={styles['panel']}>
      <Button variant="primary" busy={googlePending} onClick={() => void onGoogleSignIn()}>
        {t('auth.signInWithGoogle')}
      </Button>
      {googleError !== null && (
        <Alert tone="danger" title={t('auth.signInFailed')}>
          <p>{googleError}</p>
        </Alert>
      )}

      <Button variant="secondary" busy={applePending} onClick={() => void onAppleSignIn()}>
        {t('auth.signInWithApple')}
      </Button>
      {appleError !== null && (
        <Alert tone="danger" title={t('auth.signInFailed')}>
          <p>{appleError}</p>
        </Alert>
      )}

      <div className={styles['divider']} role="separator" aria-orientation="horizontal" />

      {linkSent ? (
        <Alert tone="info" title={t('auth.emailLinkSent')}>
          <p>{t('auth.emailLinkSentDescription')}</p>
        </Alert>
      ) : (
        <form
          className={styles['emailForm']}
          onSubmit={(event) => void onEmailSubmit(event)}
          noValidate
        >
          <TextField
            label={t('auth.emailLabel')}
            type="email"
            autoComplete="email"
            error={formState.errors.email === undefined ? undefined : t('auth.signInFailed')}
            {...register('email')}
          />
          <Button type="submit" variant="secondary" busy={formState.isSubmitting}>
            {t('auth.emailSubmit')}
          </Button>
          {emailError !== null && (
            <Alert tone="danger" title={t('auth.signInFailed')}>
              <p>{emailError}</p>
            </Alert>
          )}
        </form>
      )}
    </div>
  );
}
