'use client';

import { SharedErrorCode } from '@verdery/api-contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert } from '@/shared/ui/public';

import styles from './client-accept-invitation.module.css';
import { useAcceptClientInvitation } from './queries';

type State = 'working' | 'missingToken' | 'success' | 'error';

/**
 * Consumes a client-invitation token from the URL and calls
 * `acceptClientInvitation` — the client-portal counterpart of
 * `features/collaboration/AcceptInvitation`, which this component mirrors
 * closely: same token-from-URL / 401-triggers-sign-in-redirect / idempotent-
 * replay-is-still-200 shape, applied to the DIFFERENT resource
 * (`client_access_grant`, not `garden_membership`) and DIFFERENT response
 * type (`ClientAccessGrant`, not `GardenMember`) this contract endpoint
 * actually returns.
 *
 * Rendered at `/invite/client-portal/accept`, a SIBLING of `/invite/accept`
 * rather than the SAME route: the two accept different token namespaces
 * against different endpoints and cannot share one page body — there is no
 * discriminator in the URL alone that would let one page decide which
 * endpoint a given opaque token belongs to. Also rendered OUTSIDE
 * `/client-portal` (this work package's own new session-gated route root)
 * for the identical reason `AcceptInvitation`'s own doc comment gives for
 * living outside `/application`: `proxy.ts`'s session-cookie redirect
 * forwards only the bare pathname as `next`, which would silently drop this
 * page's `token` query parameter for a signed-out visitor.
 *
 * `ClientAccessGrant` carries no `clientGardenId` (the client-portal id
 * `listClientGardens` mints is a DELIBERATELY separate identifier from the
 * operational `engagementId` this grant does carry — architecture doc
 * section 13: "a client-facing garden handle may map internally to an
 * engagement and garden, but authorization always starts from the current
 * client profile and active access grant"), so there is no single garden to
 * deep-link into on success. The success action goes to `/client-portal` —
 * the garden switcher — rather than guessing an id the response never
 * supplies.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `acceptClientInvitation`; architecture/collaboration-and-client-sharing.md,
 * section "9. Client Invitation and Session".
 */
export function ClientAcceptInvitation() {
  const { t } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mutation = useAcceptClientInvitation();
  const [state, setState] = useState<State>('working');

  useEffect(() => {
    const token = searchParams.get('token');

    if (token === null || token.trim() === '') {
      setState('missingToken');
      return;
    }

    mutation.mutate(token, {
      onSuccess: () => {
        setState('success');
      },
      onError: (error) => {
        if (error.failure.code === SharedErrorCode.Unauthenticated) {
          const next = `/invite/client-portal/accept?token=${encodeURIComponent(token)}`;
          router.push(`/auth/sign-in?next=${encodeURIComponent(next)}`);
          return;
        }
        setState('error');
      },
    });
    // Runs once, against the token present on first render.
  }, []);

  if (state === 'working') {
    return <p role="status">{t('clientPortal.inviteWorking')}</p>;
  }

  if (state === 'missingToken') {
    return (
      <Alert tone="danger" title={t('clientPortal.inviteTitle')}>
        <p>{t('clientPortal.inviteMissingToken')}</p>
      </Alert>
    );
  }

  if (state === 'success') {
    return (
      <Alert tone="info" title={t('clientPortal.inviteSuccessTitle')}>
        <p>{t('clientPortal.inviteSuccessDescription')}</p>
        <div className={styles['actions']}>
          <Button variant="primary" onClick={() => router.push('/client-portal')}>
            {t('clientPortal.inviteGoToGardens')}
          </Button>
        </div>
      </Alert>
    );
  }

  if (mutation.isError) {
    return <FailureAlert failure={mutation.error.failure} />;
  }

  return (
    <Alert tone="danger" title={t('clientPortal.inviteTitle')}>
      <p>{t('clientPortal.inviteMissingToken')}</p>
    </Alert>
  );
}
