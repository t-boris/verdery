import { getRequestTranslator } from '@/shared/localization/server';

import { GardenSettings } from '@/features/gardens/public';
import { GardenPhotoUpload, GardenPlanUpload } from '@/features/media/public';

import styles from './page.module.css';

/**
 * The garden's overview and settings. Cross-section navigation lives in the
 * application shell's garden tabs, so this page carries only its own content.
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
    </div>
  );
}
