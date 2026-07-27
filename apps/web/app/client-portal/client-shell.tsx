'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState, type ComponentType, type ReactNode } from 'react';

import { createBrowserApiClient, createSessionGateway } from '@/core/api/public';
import { signOutOfFirebase } from '@/core/auth/public';
import { useLocalization, type MessageKey } from '@/shared/localization/public';
import {
  Button,
  CheckCircleIcon,
  EyeIcon,
  HomeIcon,
  SignOutIcon,
  classNames,
  type IconProps,
} from '@/shared/ui/public';

import styles from './client-shell.module.css';

interface ClientGardenSection {
  readonly href: string;
  readonly labelKey: MessageKey;
  readonly icon: ComponentType<IconProps>;
  /** Match the pathname exactly instead of by prefix — the overview tab only. */
  readonly exact: boolean;
}

/**
 * The garden section tabs, rendered only when the current route carries a
 * `clientGardenId` segment — the client-portal mirror of
 * `application-shell.tsx`'s own `gardenSections`. `CheckCircleIcon`/`EyeIcon`
 * are reused from the operational shell's own icon set rather than adding
 * new ones: every icon here is `aria-hidden` decorative reinforcement of an
 * adjacent visible label (`icons.tsx`'s own doc comment), never load-bearing
 * on its own, so reusing an icon across two entirely separate navigations
 * carries no meaning collision a reader could notice.
 */
function clientGardenSections(clientGardenId: string): readonly ClientGardenSection[] {
  const base = `/client-portal/${clientGardenId}`;
  return [
    { href: base, labelKey: 'clientPortal.overviewTab', icon: HomeIcon, exact: true },
    {
      href: `${base}/publications`,
      labelKey: 'clientPortal.publicationsTab',
      icon: CheckCircleIcon,
      exact: false,
    },
    { href: `${base}/timeline`, labelKey: 'clientPortal.timelineTab', icon: EyeIcon, exact: false },
  ];
}

/**
 * Navigation and sign-out for every route under `/client-portal` (P9C-WEB-01)
 * — NOT `ApplicationShell`. A client-portal caller may hold ZERO operational
 * access (no garden membership, no organization membership at all), only a
 * `client_access_grant` — `ApplicationShell`'s "Gardens"/"Organizations" nav
 * would show such a caller two root links to features they cannot reach.
 * This shell instead offers exactly what a client needs: which garden (a
 * "My gardens" link back to the switcher — always rendered, the same
 * "no data is fetched here" posture `ApplicationShell`'s own doc comment
 * documents for its own root links, since a client may hold more than one
 * active engagement), the current garden's own read-only sections, and
 * sign-out.
 *
 * Reuses the SAME session-cookie authentication `proxy.ts` gates
 * `/application` behind, extended to cover `/client-portal` too, rather than
 * a parallel auth mechanism — see `proxy.ts`'s own doc comment.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "14. Web and Native Surfaces" ("The client portal is a responsive route
 * group in the existing web deployment with its own layout, navigation,
 * gateways, queries, analytics allowlist, and tests").
 */
export function ClientShell({ children }: { readonly children: ReactNode }) {
  const { t } = useLocalization();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  const rawClientGardenId = params['clientGardenId'];
  const clientGardenId = typeof rawClientGardenId === 'string' ? rawClientGardenId : null;

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
      <div className={styles['bar']}>
        <nav className={styles['primaryNav']} aria-label={t('clientPortal.shellPrimaryNavLabel')}>
          <Link
            className={styles['rootLink']}
            href="/client-portal"
            aria-current={pathname === '/client-portal' ? 'page' : undefined}
          >
            {t('clientPortal.myGardens')}
          </Link>
        </nav>
        <Button variant="secondary" busy={signingOut} onClick={() => void onSignOut()}>
          <SignOutIcon />
          {t('shell.signOut')}
        </Button>
      </div>

      {clientGardenId !== null && (
        <nav className={styles['tabs']} aria-label={t('clientPortal.gardenNavLabel')}>
          {clientGardenSections(clientGardenId).map((section) => {
            const active = section.exact
              ? pathname === section.href
              : pathname.startsWith(section.href);
            const Icon = section.icon;
            return (
              <Link
                key={section.href}
                className={classNames(styles['tab'], active && styles['tabActive'])}
                href={section.href}
                aria-current={active ? 'page' : undefined}
              >
                <Icon />
                <span>{t(section.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <div className={styles['content']}>{children}</div>
    </div>
  );
}
