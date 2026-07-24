import Link from 'next/link';

import { AddPlantForm, OpenPlantByIdForm, PlantList } from '@/features/plants/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * The plants entry point for a garden: browse the inventory, add a plant, or
 * open a known one directly.
 *
 * `PlantList` (P4-SEARCH-01 follow-up) backs the inventory browse against
 * the real `SearchPlants` endpoint (`GET /gardens/{gardenId}/plants`), which
 * this page previously had no client for — see
 * `docs/development/deferred-capabilities.md` for the now-closed history of
 * that gap. `OpenPlantByIdForm` stays alongside it as a direct-navigation
 * shortcut for a plant id already known from elsewhere (e.g. a link shared
 * outside the app); it is no longer this page's only way to reach a plant.
 *
 * Source: implementation-plan.md work packages P4-WEB-01, P4-SEARCH-01;
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
        <h2 className={styles['sectionTitle']}>{t('plants.inventoryTitle')}</h2>
        <PlantList gardenId={gardenId} />
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
