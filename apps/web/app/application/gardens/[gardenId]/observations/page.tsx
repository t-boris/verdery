import { ObservationTimeline, RecordObservationForm } from '@/features/observations/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { RouteBody, RouteHeader, RoutePage, RoutePanel, RouteSplit } from '@/shared/ui/public';

/**
 * The garden-wide observation history: record a new one, and see the full
 * chronological timeline (`ListObservationsForGarden`).
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Observations`.
 */
export default async function ObservationsPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('observations.pageTitle')}
        description={t('observations.pageDescription')}
      />
      <RouteSplit>
        <RouteBody>
          <RoutePanel title={t('observations.historyTitle')}>
            <ObservationTimeline gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
        <RouteBody>
          <RoutePanel title={t('observations.recordTitle')}>
            <RecordObservationForm gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
      </RouteSplit>
    </RoutePage>
  );
}
