'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { createBrowserApiClient, createSessionGateway } from '@/core/api/public';
import { signOutOfFirebase } from '@/core/auth/public';
import { useLocalization } from '@/shared/localization/public';
import { Button } from '@/shared/ui/public';

import styles from './application-shell.module.css';

/**
 * Navigation and sign-out for every authenticated route.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "5. Web Session Flow", step 6 ("Logout clears the cookie and may revoke
 * refresh tokens").
 */
export function ApplicationShell({ children }: { readonly children: ReactNode }) {
  const { t } = useLocalization();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);

    // Revokes server-side refresh tokens first — a Firebase-only sign-out
    // would leave a still-valid session cookie behind.
    await createSessionGateway(createBrowserApiClient()).endSession();
    await signOutOfFirebase().catch(() => {
      // The server session is already cleared regardless of whether the
      // client SDK's own local state finishes clearing.
    });

    router.push('/auth/sign-in');
  };

  return (
    <div className={styles['shell']}>
      <nav className={styles['nav']}>
        <Link className={styles['navLink']} href="/application/gardens">
          {t('gardens.title')}
        </Link>
        <Button variant="secondary" busy={signingOut} onClick={() => void onSignOut()}>
          {t('shell.signOut')}
        </Button>
      </nav>
      <div className={styles['content']}>{children}</div>
    </div>
  );
}
