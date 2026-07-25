import Link from 'next/link';

import { TodayList } from '@/features/recommendations/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * The garden's Today view: the small prioritized set of actionable
 * recommendations, each with its reason, urgency, uncertainty, evidence,
 * and controls — the Phase 7 exit criterion's own field list.
 *
 * Source: implementation-plan.md work package P7-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Recommendations`.
 */
export default async function TodayPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <Link className={styles['back']} href={`/application/gardens/${gardenId}`}>
        {t('map.page.backToSettings')}
      </Link>
      <div>
        <h1 className={styles['title']}>{t('today.pageTitle')}</h1>
        <p className={styles['description']}>{t('today.pageDescription')}</p>
      </div>

      <TodayList gardenId={gardenId} />
    </div>
  );
}
