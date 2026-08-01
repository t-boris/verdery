'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState, type ComponentType, type ReactNode } from 'react';

import { createBrowserApiClient, createSessionGateway } from '@/core/api/public';
import { signOutOfFirebase } from '@/core/auth/public';
import { useLocalization, type MessageKey } from '@/shared/localization/public';
import {
  Button,
  CalendarIcon,
  CheckCircleIcon,
  EyeIcon,
  HomeIcon,
  LightbulbIcon,
  MapIcon,
  SignOutIcon,
  SproutIcon,
  SunIcon,
  classNames,
  type IconProps,
} from '@/shared/ui/public';

import styles from './application-shell.module.css';

interface GardenSection {
  readonly href: string;
  readonly labelKey: MessageKey;
  readonly icon: ComponentType<IconProps>;
  /** Match the pathname exactly instead of by prefix — the overview tab only. */
  readonly exact: boolean;
}

/**
 * The garden section tabs. Rendered only when the current route carries a
 * `gardenId` segment, so the gardens list keeps an uncluttered bar. The hrefs
 * are the same routes the pages already declare — this navigation adds no
 * routing of its own.
 */
function gardenSections(gardenId: string): readonly GardenSection[] {
  const base = `/application/gardens/${gardenId}`;
  return [
    { href: base, labelKey: 'shell.overviewTab', icon: HomeIcon, exact: true },
    { href: `${base}/today`, labelKey: 'today.pageTitle', icon: SunIcon, exact: false },
    {
      href: `${base}/seasonal-plan`,
      labelKey: 'seasonalPlan.pageTitle',
      icon: CalendarIcon,
      exact: false,
    },
    { href: `${base}/map`, labelKey: 'shell.mapTab', icon: MapIcon, exact: false },
    { href: `${base}/plants`, labelKey: 'plants.pageTitle', icon: SproutIcon, exact: false },
    {
      href: `${base}/candidates`,
      labelKey: 'candidates.pageTitle',
      icon: LightbulbIcon,
      exact: false,
    },
    {
      href: `${base}/observations`,
      labelKey: 'observations.pageTitle',
      icon: EyeIcon,
      exact: false,
    },
    { href: `${base}/tasks`, labelKey: 'tasks.pageTitle', icon: CheckCircleIcon, exact: false },
  ];
}

/**
 * Navigation and sign-out for every authenticated route.
 *
 * The bar is purely structural: the garden identifier is read from the route
 * parameters, and no data is fetched here — the shell must render instantly
 * on every authenticated page, including error states.
 *
 * The section links are plain anchors inside a labeled `<nav>`, deliberately
 * not a list: several end-to-end assertions count `listitem` roles on a page,
 * and chrome must never leak into content-level queries.
 *
 * `Organizations` (P9B-WEB-01) is a SECOND root link, always rendered next
 * to `Gardens` rather than shown only once a lightweight query confirms the
 * profile already belongs to one — the professional workspace is not
 * garden-scoped, so it needs its own top-level entry point, and this bar's
 * own "no data is fetched here" constraint above rules out gating it behind
 * a membership check. It is also symmetrical with `Gardens` itself: garden
 * creation is equally open to anyone and that link is never hidden for a
 * profile with zero gardens either — `GardenList`'s own empty state is where
 * "you have none yet" belongs, not the shell. `OrganizationList` carries the
 * identical empty state for organizations.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "5. Web Session Flow", step 6 ("Logout clears the cookie and may revoke
 * refresh tokens"); implementation-plan.md work package P9B-WEB-01.
 */
export function ApplicationShell({ children }: { readonly children: ReactNode }) {
  const { t } = useLocalization();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  const rawGardenId = params['gardenId'];
  const gardenId = typeof rawGardenId === 'string' ? rawGardenId : null;

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
        <nav className={styles['primaryNav']} aria-label={t('shell.primaryNavLabel')}>
          <Link
            className={styles['rootLink']}
            href="/application/gardens"
            aria-current={pathname === '/application/gardens' ? 'page' : undefined}
          >
            {t('gardens.title')}
          </Link>
          <Link
            className={styles['rootLink']}
            href="/application/organizations"
            aria-current={pathname.startsWith('/application/organizations') ? 'page' : undefined}
          >
            {t('organizations.title')}
          </Link>
        </nav>
        <Button variant="secondary" busy={signingOut} onClick={() => void onSignOut()}>
          <SignOutIcon />
          {t('shell.signOut')}
        </Button>
      </div>

      {gardenId !== null && (
        <nav className={styles['tabs']} aria-label={t('shell.gardenNavLabel')}>
          {gardenSections(gardenId).map((section) => {
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
