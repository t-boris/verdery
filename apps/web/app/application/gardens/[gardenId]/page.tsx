import { getRequestTranslator } from '@/shared/localization/server';

import { Collaborators } from '@/features/collaboration/public';
import { GardenSettings } from '@/features/gardens/public';
import { GardenPhotoUpload, GardenPlanUpload } from '@/features/media/public';
import {
  GardenAssignmentsSection,
  GardenEngagementsSection,
} from '@/features/organizations/public';

import styles from './page.module.css';

/**
 * The garden's overview and settings. Cross-section navigation lives in the
 * application shell's garden tabs, so this page carries only its own content.
 *
 * `GardenAssignmentsSection`/`GardenEngagementsSection` (P9B-WEB-01) are
 * composed here as further SIBLINGS, the same way `GardenPhotoUpload`/
 * `GardenPlanUpload`/`Collaborators` already are — never nested inside
 * `Collaborators`, even though all four sections concern who can reach this
 * garden, because they read a genuinely different domain
 * (`collaboration.garden_assignment`/`client_engagement`, the professional-
 * service tables, not `collaboration.membership`/`invitation`) through a
 * separate feature that does not import `features/collaboration`.
 */
export default async function GardenSettingsPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('gardens.settingsTitle')}</h1>
      </div>
      <GardenSettings gardenId={gardenId} />
      <GardenPhotoUpload gardenId={gardenId} />
      <GardenPlanUpload gardenId={gardenId} />
      <Collaborators gardenId={gardenId} />
      <GardenAssignmentsSection gardenId={gardenId} />
      <GardenEngagementsSection gardenId={gardenId} />
    </div>
  );
}
