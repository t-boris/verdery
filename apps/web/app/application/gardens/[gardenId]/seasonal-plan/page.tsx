import { SeasonalPlanView } from '@/features/seasonal-plan/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * The garden's Seasonal plan section: configured sow/transplant/harvest
 * windows and continuous bed-rotation status — a sibling of `map`/
 * `observations`/`plants`/`tasks`/`today`, not folded into Today, per this
 * package's own brief ("without overwhelming Today").
 *
 * Source: implementation-plan.md work package P9D-UX-01;
 * packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
 */
export default async function SeasonalPlanPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('seasonalPlan.pageTitle')}</h1>
        <p className={styles['description']}>{t('seasonalPlan.pageDescription')}</p>
      </div>

      <SeasonalPlanView gardenId={gardenId} />
    </div>
  );
}
