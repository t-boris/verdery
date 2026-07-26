'use client';

import type { GardenMember } from '@verdery/api-contracts';
import { SharedErrorCode } from '@verdery/api-contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert } from '@/shared/ui/public';

import styles from './accept-invitation.module.css';
import { roleLabel } from './labels';
import { useAcceptInvitation } from './queries';

type State = 'working' | 'missingToken' | 'success' | 'error';

/**
 * Consumes an invitation token from the URL and calls `acceptInvitation`.
 *
 * The endpoint requires an AUTHENTICATED caller. This route lives OUTSIDE
 * `/application` specifically so `proxy.ts`'s session-cookie redirect never
 * touches it — that redirect only forwards the bare pathname as `next`, not
 * the query string, which would silently drop the token
 * (`proxy.ts`: `const { pathname } = request.nextUrl`). Instead, a `401`
 * (`auth.unauthenticated`) from the accept call itself is what triggers the
 * sign-in redirect here, built with the FULL path including the token, so
 * nothing is lost — the same "every actual request is verified server-side"
 * posture `proxy.ts`'s own header comment documents, applied to a route the
 * proxy's redirect does not cover at all.
 *
 * The success path does not distinguish "was already a member" from
 * "freshly accepted" — the contract does not either; both are `200` with
 * the caller's current `GardenMember`. Every other branch
 * (expired/revoked/already-accepted-by-someone-else/email-mismatch/not-found)
 * renders through the ordinary `FailureAlert`/`errorMessageKey` path, each
 * with its own distinct message.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `acceptInvitation`;
 * architecture/identity-and-authorization.md, section "10. Invitations".
 */
export function AcceptInvitation() {
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mutation = useAcceptInvitation();
  const [state, setState] = useState<State>('working');
  const [member, setMember] = useState<GardenMember | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');

    if (token === null || token.trim() === '') {
      setState('missingToken');
      return;
    }

    mutation.mutate(token, {
      onSuccess: (result) => {
        setMember(result);
        setState('success');
      },
      onError: (error) => {
        if (error.failure.code === SharedErrorCode.Unauthenticated) {
          const next = `/invite/accept?token=${encodeURIComponent(token)}`;
          router.push(`/auth/sign-in?next=${encodeURIComponent(next)}`);
          return;
        }
        setState('error');
      },
    });
    // Runs once, against the token present on first render.
  }, []);

  if (state === 'working') {
    return <p role="status">{t('invite.working')}</p>;
  }

  if (state === 'missingToken') {
    return (
      <Alert tone="danger" title={t('invite.title')}>
        <p>{t('invite.missingToken')}</p>
      </Alert>
    );
  }

  if (state === 'success' && member !== null) {
    return (
      <Alert tone="info" title={t('invite.successTitle')}>
        <p>{t('invite.successDescription', { role: t(roleLabel(member.role)) })}</p>
        <div className={styles['actions']}>
          <Button
            variant="primary"
            onClick={() => router.push(`/application/gardens/${member.gardenId}`)}
          >
            {t('invite.goToGarden')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (mutation.isError) {
    return <FailureAlert failure={mutation.error.failure} />;
  }

  return (
    <Alert tone="danger" title={t('invite.title')}>
      <p>{t('invite.missingToken')}</p>
    </Alert>
  );
}
