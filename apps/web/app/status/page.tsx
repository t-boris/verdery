import { getRequestTranslator } from '@/shared/localization/server';

import { HealthPanel } from './health-panel';
import styles from '../page.module.css';

/**
 * Service status route.
 *
 * It is the shell's end-to-end proof: the page reaches the deployed API through
 * the typed gateway and renders both a healthy and an unreachable outcome as
 * ordinary interface state.
 *
 * Source: docs/implementation-plan.md, work package `P1-WEB-01`.
 */
export default async function StatusPage() {
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t('status.title')}</h1>
      <p className={styles['description']}>{t('status.description')}</p>
      <HealthPanel />
    </div>
  );
}
