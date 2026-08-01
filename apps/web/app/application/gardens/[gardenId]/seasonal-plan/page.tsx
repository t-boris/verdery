import { SeasonalPlanView } from '@/features/seasonal-plan/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

/**
 * The garden's Seasonal plan section: configured sow/transplant/harvest
 * windows and continuous bed-rotation status — a sibling of `map`/
 * `observations`/`plants`/`tasks`/`today`, not folded into Today, per this
 * package's own brief ("without overwhelming Today").
 *
 * Source: implementation-plan.md work package P9D-UX-01;
 * packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
 */
export default async function SeasonalPlanPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('seasonalPlan.pageTitle')}
        description={t('seasonalPlan.pageDescription')}
      />
      <RouteBody>
        <RoutePanel fill>
          <SeasonalPlanView gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
