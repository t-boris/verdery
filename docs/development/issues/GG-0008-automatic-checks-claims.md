# GG-0008: Automatic Checks overstate readiness and hide per-target eligibility

| Field          | Value        |
| -------------- | ------------ |
| Status         | `analyzed`   |
| Severity       | `SEV-3`      |
| Surface        | `web / API`  |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The Automatic Checks panel accurately lists the seven active rule versions and garden-level input
blockers, but its `Running` status means only that coarse preconditions are present. It does not
mean that a rule evaluated successfully for every plant, that it produced a recommendation, or
that its thresholds have been approved. The current introductory copy overstates this distinction.

## Verified rule behavior

- Watering v2 uses the latest temperature plus rainfall accumulated over seven elapsed days. It
  requires at least four measured days, active-growth stages, and uses labelled stale temperature
  at reduced confidence. Its 25 mm reference, 50% deficit, 20 °C threshold, and 72-hour recurrence
  are awaiting horticultural review.
- The quick-condition reminder is plant-specific: an active plant is due after 14 days since its
  latest observation, or since creation if never observed. Garden- or area-only observations do
  not satisfy that plant's check.
- Harvest readiness relies only on a user-declared `ready_to_harvest` lifecycle stage. It does not
  infer ripeness. Its five-day validity and seven-day recurrence are unreviewed.
- Frost watch is the only elevated-risk rule. It uses an upcoming forecast at or below 0 °C and
  skips stale, past, or temperature-less forecasts completely. It targets only seedling,
  transplanted, and flowering stages, and expires at the forecast moment.
- Seasonal sow/transplant checks require a georeferenced hemisphere, an active identified plant,
  and a garden-accepted taxon fact. They report a configured window that is open or within 14 days;
  wraparound month ranges are covered by fixtures.
- Succession requires an accepted per-taxon interval, but the engine recurrence is a static 21-day
  fallback rather than the displayed taxon's interval. The true interval is evidence and copy,
  not the scheduling cadence.
- Rotation requires hemisphere, taxon and family, an accepted rest period, a placed plant, and a
  prior occupant with a known departure. One `season` is hard-coded as 365 days. Unknown bed
  history is treated as no provable conflict, not as proof that rotation is safe.

All seven active rules carry `awaiting_horticultural_review`. The UI intentionally treats that as
disclosure rather than an obstruction, so it can show `Running` and an unreviewed-threshold notice
at the same time.

## Supported UX findings

1. `Running` is derived from garden-level readiness, while many actual skip reasons are per plant:
   status, lifecycle, taxonomy, configured window/interval, family, placement, prior occupancy,
   recurrence, and postponement. Those reasons never appear in this panel.
2. “These run on their own and decide what this garden needs” implies a stronger agronomic
   conclusion than code supports while every threshold is still a placeholder.
3. The API returns English `actionTitle` and `description` strings, and the Russian client renders
   them directly. Blocker explanations are localized, but rule identities and descriptions are not.
4. `seasonalTimingNotAccepted` is a garden-level “none accepted” signal. It cannot explain partial
   coverage where one taxon is accepted and another is not.
5. Most blockers say why but provide no direct recovery route. Only missing location has an action;
   accepted timing is described as “below” rather than linked or focused.

## Acceptance criteria

- Rename `Running` to a precise state such as `Inputs available`, and explain that eligibility and
  recommendation output are evaluated per plant.
- Present review state as a first-class warning and avoid saying that unreviewed rules determine
  what a garden “needs.”
- Localize rule titles/descriptions using rule keys, not server-authored English strings.
- Show the exact inputs, time window, stale-data posture, and important per-target skip conditions
  for each rule without claiming a recommendation has fired.
- Link every user-resolvable blocker to its control, including seasonal acceptance and placement.
- Distinguish no accepted seasonal data from partial taxon coverage.
- Keep elevated-risk visibly distinct and state that frost skips stale forecasts.
- Preserve all current safe semantics: unknown is not zero/dry/safe, no inferred harvest readiness,
  accepted seasonal facts only, and explicit unresolved review thresholds.

## Verification

Code paths and public copy were compared with the active launch catalog, all seven evaluators, the
garden readiness endpoint, cross-rule fixtures, seasonal fixtures, completed-work suppression, and
the safety catalog. No safe focused engine correction was warranted; this issue records a truthful
presentation gap and the known succession/rotation model limitations.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: GG-0004, GG-0007

## History

| Date       | Change                                                             |
| ---------- | ------------------------------------------------------------------ |
| 2026-08-31 | Audited all seven checks and recorded supported presentation gaps. |
