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
      <h1 className={styles['title']}>{t('map.page.title')}</h1>
      <MapEditor gardenId={gardenId} />
    </div>
  );
}
