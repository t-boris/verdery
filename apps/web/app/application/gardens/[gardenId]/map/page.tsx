import Link from 'next/link';

import { MapEditor } from '@/features/map/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

export default async function GardenMapPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <div className={styles['header']}>
        <Link className={styles['back']} href={`/application/gardens/${gardenId}`}>
          {t('map.page.backToSettings')}
        </Link>
        <h1 className={styles['title']}>{t('map.page.title')}</h1>
      </div>
      <MapEditor gardenId={gardenId} />
    </div>
  );
}
