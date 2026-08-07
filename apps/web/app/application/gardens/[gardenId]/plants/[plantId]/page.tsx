import Link from 'next/link';

import { PlantDetail } from '@/features/plants/public';
import { ObservationTimeline, PlantJournalStrip } from '@/features/observations/public';
import { getRequestTranslator } from '@/shared/localization/server';
import {
  ActionDisclosure,
  EyeIcon,
  RouteBody,
  RouteHeader,
  RoutePage,
  RoutePanel,
  SproutIcon,
} from '@/shared/ui/public';

import { RecordJournalEntryPanel } from './record-journal-entry-panel';
import { PlantPhotoUpload } from './plant-photo-upload';
import styles from './page.module.css';

/**
 * A single plant's detail page, composing `features/plants` with
 * `features/observations` at the route layer — the intended seam for
 * combining two features (see `features/observations/observation-timeline.tsx`'s
 * doc comment for why neither feature imports the other directly).
 *
 * The back link stays even though the shell's Plants tab also leads to the
 * list: this page is a drill-down inside the section, and the explicit link
 * is the clearer way out of it.
 *
 * Source: implementation-plan.md work package P4-WEB-01.
 */
export default async function PlantDetailPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string; plantId: string }>;
}) {
  const { gardenId, plantId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('plants.pageTitle')}
        icon={<SproutIcon size={18} />}
        actions={
          <Link className={styles['back']} href={`/application/gardens/${gardenId}/plants`}>
            {t('plants.backToPlants')}
          </Link>
        }
      />
      <RouteBody>
        <PlantDetail
          gardenId={gardenId}
          plantId={plantId}
          photoUpload={<PlantPhotoUpload gardenId={gardenId} plantId={plantId} />}
          journal={
            <RoutePanel title={t('observations.journalTitle')}>
              <PlantJournalStrip gardenId={gardenId} plantId={plantId} />
            </RoutePanel>
          }
          observationComposer={
            <ActionDisclosure title={t('observations.recordTitle')} icon={<EyeIcon />}>
              <RecordJournalEntryPanel gardenId={gardenId} plantId={plantId} />
            </ActionDisclosure>
          }
          history={
            <RoutePanel title={t('observations.historyTitle')}>
              <ObservationTimeline gardenId={gardenId} plantId={plantId} />
            </RoutePanel>
          }
        />
      </RouteBody>
    </RoutePage>
  );
}
