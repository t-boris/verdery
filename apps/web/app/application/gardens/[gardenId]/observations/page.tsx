import { ObservationTimeline, RecordObservationForm } from '@/features/observations/public';
import { getRequestTranslator } from '@/shared/localization/server';
import {
  ActionDisclosure,
  EyeIcon,
  PlusIcon,
  RouteBody,
  RouteHeader,
  RoutePage,
  RoutePanel,
} from '@/shared/ui/public';

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
        icon={<EyeIcon size={18} />}
      />
      <RouteBody>
        <ActionDisclosure title={t('observations.recordTitle')} icon={<PlusIcon />}>
          <RecordObservationForm gardenId={gardenId} />
        </ActionDisclosure>
        <RoutePanel title={t('observations.historyTitle')}>
          <ObservationTimeline gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
