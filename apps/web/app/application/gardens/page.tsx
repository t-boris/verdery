import { getRequestTranslator } from '@/shared/localization/server';

import { IncomingOwnershipTransfers } from '@/features/collaboration/public';
import { CreateGardenForm, GardenList } from '@/features/gardens/public';
import { RouteBody, RouteDashboard, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

/**
 * First-garden vertical slice: list and create.
 *
 * `IncomingOwnershipTransfers` sits above `GardenList` — every pending
 * ownership offer addressed to the caller, across every garden, is more
 * urgent than the list of gardens they already own or collaborate on. See
 * its own module comment for why it is composed here rather than imported
 * by `features/gardens` itself.
 *
 * On the shared route chrome (`RoutePage`/`RouteHeader`/`RoutePanel`) rather
 * than a stylesheet of its own. It was the last authenticated route still
 * carrying the legacy standalone layout. Keeping it on the shared Field
 * Console chrome makes the first authenticated screen and every garden
 * workspace read as one product.
 *
 * Source: implementation-plan.md work package P2-WEB-01, P9A-OWNER-02.
 */
export default async function GardensPage() {
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader title={t('gardens.title')} description={t('gardens.description')} />
      <RouteBody>
        <RouteDashboard>
          <RoutePanel>
            <IncomingOwnershipTransfers />
            <GardenList />
          </RoutePanel>
          <RoutePanel title={t('gardens.createTitle')}>
            <CreateGardenForm />
          </RoutePanel>
        </RouteDashboard>
      </RouteBody>
    </RoutePage>
  );
}
