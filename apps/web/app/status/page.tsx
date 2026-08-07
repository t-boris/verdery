import { getRequestTranslator } from '@/shared/localization/server';
import { PulseIcon, RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

import { HealthPanel } from './health-panel';

/**
 * Service status route.
 *
 * It is the shell's end-to-end proof: the page reaches the deployed API through
 * the typed gateway and renders both a healthy and an unreachable outcome as
 * ordinary interface state.
 *
 * Source: docs/implementation-plan.md, work package `P1-WEB-01`.
 */
export default async function StatusPage() {
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('status.title')}
        description={t('status.description')}
        icon={<PulseIcon size={18} />}
      />
      <RouteBody>
        <RoutePanel>
          <HealthPanel />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
