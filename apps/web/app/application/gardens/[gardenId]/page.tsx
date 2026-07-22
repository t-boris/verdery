import Link from 'next/link';

import { getRequestTranslator } from '@/shared/localization/server';

import { GardenSettings } from '@/features/gardens/public';

import styles from './page.module.css';

export default async function GardenSettingsPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <Link className={styles['back']} href="/application/gardens">
        {t('gardens.backToList')}
      </Link>
      <div className={styles['titleRow']}>
        <h1 className={styles['title']}>{t('gardens.settingsTitle')}</h1>
        <Link className={styles['mapLink']} href={`/application/gardens/${gardenId}/map`}>
          {t('map.page.openMap')}
        </Link>
      </div>
      <GardenSettings gardenId={gardenId} />
    </div>
  );
}
