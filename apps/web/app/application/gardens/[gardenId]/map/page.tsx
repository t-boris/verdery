import { MapEditor } from '@/features/map/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { MapIcon, RouteHeader } from '@/shared/ui/public';

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
      {/* The shared header strip, not a local copy of one: this route cannot
          use `RoutePage`/`RouteBody` — the editor needs the whole remaining
          height for its own four-region grid — but its title has no reason to
          be a different size from every other route's. */}
      <RouteHeader
        title={t('map.page.title')}
        description={t('map.page.description')}
        icon={<MapIcon size={18} />}
      />
      <MapEditor gardenId={gardenId} />
    </div>
  );
}
