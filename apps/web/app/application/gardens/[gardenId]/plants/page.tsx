import Link from 'next/link';

import { AddPlantForm, OpenPlantByIdForm } from '@/features/plants/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * The plants entry point for a garden: add a plant, or open a known one.
 *
 * The contract has no `GET /gardens/{gardenId}/plants` list operation —
 * only single-plant `GetPlant` — so this page cannot show a real inventory
 * list without inventing a client-side aggregation the API does not back.
 * `OpenPlantByIdForm` is the honest alternative: pure navigation, no
 * fabricated data. See that component's own doc comment.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Plants`.
 */
export default async function PlantsPage({
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
        <h1 className={styles['title']}>{t('plants.pageTitle')}</h1>
        <p className={styles['description']}>{t('plants.pageDescription')}</p>
      </div>

      <div>
        <h2 className={styles['sectionTitle']}>{t('plants.openByIdTitle')}</h2>
        <OpenPlantByIdForm gardenId={gardenId} />
      </div>

      <div>
        <h2 className={styles['sectionTitle']}>{t('plants.addTitle')}</h2>
        <AddPlantForm gardenId={gardenId} />
      </div>
    </div>
  );
}
