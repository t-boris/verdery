import { AddPlantForm, OpenPlantByIdForm, PlantList } from '@/features/plants/public';
import { getRequestTranslator } from '@/shared/localization/server';

import { AddPlantFromPhotoPanel } from './add-plant-from-photo-panel';
import styles from './page.module.css';

/**
 * The plants entry point for a garden: browse the inventory, add a plant
 * (manually or from a photo), or open a known one directly.
 *
 * `PlantList` (P4-SEARCH-01 follow-up) backs the inventory browse against
 * the real `SearchPlants` endpoint (`GET /gardens/{gardenId}/plants`), which
 * this page previously had no client for — see
 * `docs/development/deferred-capabilities.md` for the now-closed history of
 * that gap. `OpenPlantByIdForm` stays alongside it as a direct-navigation
 * shortcut for a plant id already known from elsewhere (e.g. a link shared
 * outside the app); it is no longer this page's only way to reach a plant.
 * `AddPlantFromPhotoPanel` (ADR-0015) is this page's third way in — see that
 * component's own doc comment for why it lives beside this file rather than
 * inside `features/plants`.
 *
 * Source: implementation-plan.md work packages P4-WEB-01, P4-SEARCH-01;
 * packages/api-contracts/openapi.yaml, tag `Plants`; ADR-0015.
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
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('plants.pageTitle')}</h1>
        <p className={styles['description']}>{t('plants.pageDescription')}</p>
      </div>

      <div className={styles['section']}>
        <h2 className={styles['sectionTitle']}>{t('plants.inventoryTitle')}</h2>
        <PlantList gardenId={gardenId} />
      </div>

      <div className={styles['panelGrid']}>
        <section className={styles['panel']}>
          <h2 className={styles['sectionTitle']}>{t('plants.addTitle')}</h2>
          <AddPlantForm gardenId={gardenId} />
        </section>

        <section className={styles['panel']}>
          <h2 className={styles['sectionTitle']}>{t('plants.addFromPhotoTitle')}</h2>
          <AddPlantFromPhotoPanel gardenId={gardenId} />
        </section>

        <section className={styles['panel']}>
          <h2 className={styles['sectionTitle']}>{t('plants.openByIdTitle')}</h2>
          <OpenPlantByIdForm gardenId={gardenId} />
        </section>
      </div>
    </div>
  );
}
