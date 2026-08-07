import { AddPlantForm, OpenPlantByIdForm, PlantList } from '@/features/plants/public';
import { getRequestTranslator } from '@/shared/localization/server';
import {
  ActionDisclosure,
  ImageIcon,
  PlusIcon,
  RouteHeader,
  RoutePage,
  SearchIcon,
  SproutIcon,
} from '@/shared/ui/public';

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
  searchParams,
}: {
  readonly params: Promise<{ gardenId: string }>;
  readonly searchParams: Promise<{
    create?: string;
    placementMapObjectId?: string;
    returnTo?: string;
  }>;
}) {
  const { gardenId } = await params;
  const requested = await searchParams;
  const t = await getRequestTranslator();
  const placementMapObjectId = requested.placementMapObjectId;
  const returnHref =
    requested.returnTo === 'map' ? `/application/gardens/${gardenId}/map` : undefined;

  return (
    <RoutePage>
      <RouteHeader
        title={t('plants.pageTitle')}
        description={t('plants.pageDescription')}
        icon={<SproutIcon size={18} />}
      />
      <div className={styles['page']}>
        <div className={styles['context']}>
          {/* Photo first: it is the primary way in — the whole point of ADR-0015
            is that a photo identifies the plant for you, so the manual form is
            the fallback, not the default. */}
          <ActionDisclosure
            title={t('plants.addFromPhotoTitle')}
            description={t('plants.addFromPhotoDescription')}
            icon={<ImageIcon />}
            defaultOpen={requested.create === 'photo'}
          >
            <AddPlantFromPhotoPanel
              gardenId={gardenId}
              {...(placementMapObjectId === undefined ? {} : { placementMapObjectId })}
              {...(returnHref === undefined ? {} : { returnHref })}
            />
          </ActionDisclosure>

          <ActionDisclosure
            title={t('plants.addTitle')}
            icon={<PlusIcon />}
            defaultOpen={requested.create === 'manual'}
          >
            <AddPlantForm
              gardenId={gardenId}
              {...(placementMapObjectId === undefined
                ? {}
                : { initialPlacementMapObjectId: placementMapObjectId })}
              {...(returnHref === undefined ? {} : { returnHref })}
            />
          </ActionDisclosure>

          <ActionDisclosure title={t('plants.openByIdTitle')} icon={<SearchIcon />}>
            <OpenPlantByIdForm gardenId={gardenId} />
          </ActionDisclosure>
        </div>

        <div className={styles['library']}>
          <h2 className={styles['libraryHeading']}>{t('plants.inventoryTitle')}</h2>
          <PlantList gardenId={gardenId} />
        </div>
      </div>
    </RoutePage>
  );
}
