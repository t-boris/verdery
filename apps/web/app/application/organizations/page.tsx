import { getRequestTranslator } from '@/shared/localization/server';

import { CreateOrganizationForm, OrganizationList } from '@/features/organizations/public';

import styles from './page.module.css';

/**
 * The professional workspace's own root route: every service organization
 * the signed-in profile belongs to, and a form to create a new one.
 *
 * A vertical slice mirroring `app/application/gardens/page.tsx` exactly
 * (list + create) — the professional-service domain's own root, distinct
 * from the garden-scoped tab bar, since organization membership is not
 * garden-scoped at all.
 *
 * Source: implementation-plan.md work package P9B-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Organizations`.
 */
export default async function OrganizationsPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('organizations.title')}</h1>
        <p className={styles['description']}>{t('organizations.description')}</p>
      </div>

      <OrganizationList />

      <section className={styles['createPanel']}>
        <h2 className={styles['sectionTitle']}>{t('organizations.createTitle')}</h2>
        <CreateOrganizationForm />
      </section>
    </div>
  );
}
