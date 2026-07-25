/**
 * Port for selecting which gardens the scheduled weather-refresh sweep
 * (P7-ASYNC-01) considers this run.
 *
 * A candidate is a garden that can physically be refreshed and is still in
 * ordinary use: `lifecycle_state = 'active'` (an archived or
 * deletion-requested garden gets no ongoing external-data spend) with a
 * CURRENT georeference (`RefreshGardenWeather` degrades any garden without
 * one to the typed `gardenNotGeoreferenced` outcome — listing those would
 * only burn batch slots on a documented no-op). Plant inventory is
 * deliberately NOT a condition: weather is garden-level data
 * (`integrations.weather_record` anchors per garden, not per plant), and the
 * cache window plus provider quota already bound its cost.
 *
 * Ordering is least-recently-fetched first (`NULL` fetch time — never
 * fetched — first of all): the same most-in-need-first shape the retention
 * sweep's deadline ordering has, and what makes the bounded batch FAIR — a
 * refreshed garden's new `fetched_at` moves it to the back, so successive
 * runs rotate through the whole set instead of starving gardens beyond the
 * batch cap. With zero providers configured (today's reality) nothing
 * updates and every run sees the same front — the documented, observable
 * no-op, in which no achievable work is being starved.
 *
 * Cross-schema read (this module's `integrations.weather_record` joined with
 * gardens-mapping's `garden`/`georeference`), following the
 * `MediaReferenceFinder` precedent: a module may READ a sibling's tables
 * through its own narrow port when the query is inherently about the join,
 * rather than re-exporting half a repository across `public.ts` for one
 * ordering clause.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

export interface WeatherRefreshCandidateSource {
  /**
   * Up to `limit` active, georeferenced garden ids, least recently fetched
   * observation first (never-fetched gardens first of all; ties broken by
   * garden id for determinism).
   */
  listRefreshCandidates(limit: number): Promise<readonly Uuid[]>;
}
