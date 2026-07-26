import Link from 'next/link';

import { getRequestTranslator } from '@/shared/localization/server';

import {
  OrganizationClientEngagements,
  OrganizationGardenAssignments,
  OrganizationHeader,
  OrganizationMembers,
} from '@/features/organizations/public';

import styles from './page.module.css';

/**
 * A single organization's own workspace: its identity, active membership
 * roster, garden assignments, and client engagements — the professional-
 * service domain's equivalent of `gardens/[gardenId]/page.tsx`.
 *
 * Every section fetches its own data independently (mirroring
 * `GardenSettings`/`Collaborators`'s own sibling composition on the garden
 * settings page) rather than this page prop-drilling a single combined
 * result down.
 *
 * Source: implementation-plan.md work package P9B-WEB-01.
 */
export default async function OrganizationDetailPage({
  params,
}: {
  readonly params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <Link className={styles['backLink']} href="/application/organizations">
          {t('organizations.backToList')}
        </Link>
      </div>

      <OrganizationHeader organizationId={organizationId} />
      <OrganizationMembers organizationId={organizationId} />
      <OrganizationGardenAssignments organizationId={organizationId} />
      <OrganizationClientEngagements organizationId={organizationId} />
    </div>
  );
}
