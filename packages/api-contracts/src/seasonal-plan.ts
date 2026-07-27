/**
 * The seasonal plan domain's contract surface (P9D-SEASON-API-01) —
 * `GET /gardens/{gardenId}/seasonal-plan`'s garden-wide, forward-looking
 * seasonal-fact and continuous bed-rotation-status read, distinct from the
 * rule-fired Today/Recommendations pipeline. Split out of `index.ts` purely
 * for the repository's 600-line source-file rule, the same posture
 * `garden-context.ts`/`sync-contracts.ts` document for themselves;
 * `index.ts` re-exports everything here unchanged.
 *
 * No dedicated error-code export here: every error `getGardenSeasonalPlan`
 * can raise is already one of the existing shared codes
 * (`SharedErrorCode.Unauthenticated`/`Forbidden`, `GardenErrorCode.NotFound`)
 * — this resource introduces no new "not found" or "stale revision" case of
 * its own, the same posture `garden-context.ts` documents for itself.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The seasonal plan schemas (P9D-SEASON-API-01). */
export type Hemisphere = Schemas['Hemisphere'];
export type SeasonalPlanTaxonomyTiming = Schemas['SeasonalPlanTaxonomyTiming'];
export type SeasonalPlanTaxonomyStatusReviewed = Schemas['SeasonalPlanTaxonomyStatusReviewed'];
export type SeasonalPlanTaxonomyStatusMissing = Schemas['SeasonalPlanTaxonomyStatusMissing'];
export type SeasonalPlanTaxonomyStatus = Schemas['SeasonalPlanTaxonomyStatus'];
export type SeasonalPlanPlantEntry = Schemas['SeasonalPlanPlantEntry'];
export type SeasonalPlanRotationStatusEntry = Schemas['SeasonalPlanRotationStatusEntry'];
export type SeasonalPlanResult = Schemas['SeasonalPlanResult'];
