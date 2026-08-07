import { CareRulesPanel } from '@/features/care-rules/public';
import { TodayList } from '@/features/recommendations/public';
import { WeatherPanel } from '@/features/weather/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { RouteBody, RouteHeader, RoutePage, RoutePanel, SunIcon } from '@/shared/ui/public';

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
      <RouteHeader
        title={t('today.pageTitle')}
        description={t('today.pageDescription')}
        icon={<SunIcon size={18} />}
      />
      <RouteBody>
        {/* The conditions first, then what to do about them. Two of the seven
            rules read weather and quote the exact reading they fired on, so
            the readings above the list are what make those recommendations
            checkable — and what makes their ABSENCE legible on a day the
            garden has no weather at all. */}
        <RoutePanel>
          <WeatherPanel gardenId={gardenId} />
        </RoutePanel>
        {/* No band heading: it would repeat the route title verbatim. */}
        <RoutePanel fill>
          <TodayList gardenId={gardenId} />
        </RoutePanel>
        {/* Below the list, deliberately: this answers a question the list
            raises when it is empty, and is not the thing a person came for. */}
        <RoutePanel>
          <CareRulesPanel gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
