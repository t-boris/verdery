import { TodayList } from '@/features/recommendations/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

/**
 * The garden's Today view: the small prioritized set of actionable
 * recommendations, each with its reason, urgency, uncertainty, evidence,
 * and controls — the Phase 7 exit criterion's own field list.
 *
 * Source: implementation-plan.md work package P7-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Recommendations`.
 */
export default async function TodayPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader title={t('today.pageTitle')} description={t('today.pageDescription')} />
      <RouteBody>
        {/* No band heading: it would repeat the route title verbatim. */}
        <RoutePanel fill>
          <TodayList gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
