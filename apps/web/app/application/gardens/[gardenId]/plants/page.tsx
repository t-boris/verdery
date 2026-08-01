import { AddPlantForm, OpenPlantByIdForm, PlantList } from '@/features/plants/public';
import { getRequestTranslator } from '@/shared/localization/server';

import { AddPlantFromPhotoPanel } from './add-plant-from-photo-panel';
import styles from './page.module.css';

/**
 * The plants entry point for a garden, as Kern's two-pane library: a 296px
 * context column carrying the route's identity and every way IN to a plant,
 * beside a library pane that is nothing but the card grid.
 *
 * The three entry points moved into the context column because the grid wants
 * the full width — `repeat(6,1fr)` at 118px per tile is the point of the
 * direction, and a form sitting beside it would have taken two of the six
 * columns permanently.
 *
 * NOT IMPLEMENTED FROM THE DIRECTION: the KPI rows it lists for this column.
 * They need counts (`total plants`, `by status`) that no single call returns —
 * `PlantListResult` carries `items` and `nextCursor` and no total, so any
 * number here would either be a lie or require walking every page. Closing it
 * properly is an API change (a count on the search response), not a styling
 * one.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 4;
 * implementation-plan.md work packages P4-WEB-01, P4-SEARCH-01; ADR-0015.
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
      <div className={styles['context']}>
        <h1 className={styles['title']}>{t('plants.pageTitle')}</h1>
        <p className={styles['description']}>{t('plants.pageDescription')}</p>

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

      <div className={styles['library']}>
        <h2 className={styles['libraryHeading']}>{t('plants.inventoryTitle')}</h2>
        <PlantList gardenId={gardenId} />
      </div>
    </div>
  );
}
