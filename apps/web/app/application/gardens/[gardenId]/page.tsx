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
        <nav className={styles['navLinks']}>
          <Link className={styles['navLink']} href={`/application/gardens/${gardenId}/map`}>
            {t('map.page.openMap')}
          </Link>
          <Link className={styles['navLink']} href={`/application/gardens/${gardenId}/plants`}>
            {t('plants.pageTitle')}
          </Link>
          <Link
            className={styles['navLink']}
            href={`/application/gardens/${gardenId}/observations`}
          >
            {t('observations.pageTitle')}
          </Link>
          <Link className={styles['navLink']} href={`/application/gardens/${gardenId}/tasks`}>
            {t('tasks.pageTitle')}
          </Link>
        </nav>
      </div>
      <GardenSettings gardenId={gardenId} />
    </div>
  );
}
