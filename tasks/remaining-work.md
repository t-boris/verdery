# Remaining work — care engine, August 7, 2026

Handoff for the care-automation work. Written at the point where the deployed
state is correct but incomplete, so the next person starts from what is true
rather than from what was intended.

Everything below is either **VERIFIED** (observed directly, with the evidence
quoted) or **UNVERIFIED** (a hypothesis worth checking first). The distinction
matters most in item 1, where the wrong assumption would send someone editing
the wrong file.

---

## 1. Daily rainfall is counted more than once — BLOCKING, do this first

### What was observed (VERIFIED)

The plant care panel on `dev` rendered:

```
175.2 mm   of rain over the last 7 days
Measured across 18 of 7 days.
```

Eighteen days cannot fit in a seven-day window. For the same garden and the
same window, the Today page's weather panel rendered **58.4 mm** across six
dated bars (Aug 1: 51 mm, Aug 2-4: 0 mm, Aug 5: 7.4 mm, Aug 6: 0 mm).

Two surfaces, one window, three-fold disagreement.

### Why this is not a display bug (VERIFIED)

`GetPlantCareView` was written deliberately to read what the rule reads, and it
does. Compare:

- `services/api/src/modules/tasks-recommendations/application/evaluate-garden-recommendations.ts`
  — calls `getGardenPrecipitation.execute({ gardenId, since, intervalSeconds: DAILY_ACCUMULATION_INTERVAL_SECONDS })`,
  then `toPrecipitationWindowFact` maps entries **one-to-one** into
  `dailyTotals` with no collapse per calendar day.
- `services/api/src/modules/tasks-recommendations/application/get-plant-care-view.ts`
  — the same read, the same one-to-one mapping.

So the engine and the panel agree with each other, and both disagree with the
weather panel. The panel did not introduce the defect; it made it visible by
being the first surface to print `daysCovered` next to the window length.

### The consequence that matters

`watering.dry-spell-check@2` decides by comparing accumulated rainfall against
`DRY_THRESHOLD_MM` (12.5 mm — `referenceWeeklySupplyMm 25` × `deficitFraction 0.5`).
If the accumulated figure is inflated, the rule **under-fires**: it stays silent
on a garden that is actually short of water. That is the failure direction that
costs a plant, and it is invisible from the outside — silence looks the same
whether it is correct or wrong.

On 2026-08-07 this garden read "58.4 mm against a 25 mm norm" and the rule
correctly said nothing. Whether that conclusion survives de-duplication is
**unknown** and must be re-checked after the fix.

### Root cause (UNVERIFIED — check before editing)

The likely mechanism: the weather refresh sweep runs hourly and stores a fresh
`precipitation_sum` row for the _current_ day on every run. Each run adds
another row for the same calendar day, all with
`precipitation_interval_seconds = 86400`. Summing every row therefore counts one
day as many times as the sweep has run that day. Eighteen rows across a seven-day
window is consistent with that, but was not confirmed against the database.

**Check this first**, with something like:

```sql
SELECT effective_at::date, count(*), sum(precipitation_mm)
FROM integrations.weather_record
WHERE garden_id = '<garden>'
  AND precipitation_interval_seconds = 86400
  AND effective_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 1;
```

If one date carries several rows, the hypothesis holds. If it does not, the
cause is elsewhere and this section is wrong — do not "fix" it anyway.

Also **UNVERIFIED**: why the Today weather panel shows the correct figure. It
reads through `get-garden-weather-view.ts` rather than
`get-garden-precipitation.ts`, and something on that path evidently collapses
per day, but the collapsing code was never located. Find it before writing a
second implementation of the same idea — it may already be the right one to
share.

### Where the fix belongs

In the **shared read**, not in each caller. Three consumers already exist
(engine, plant care view, weather panel) and they have already drifted once;
fixing two of them and leaving a third is how they drift again. The candidates,
in order of preference:

1. `services/api/src/modules/integrations/persistence/kysely-weather-record-repository.ts`
   — `listElapsedPrecipitation` collapses to one row per calendar day, keeping
   the most recently recorded value for that day. This makes every caller
   correct by construction.
2. `summarizePrecipitationSince` in
   `services/api/src/modules/tasks-recommendations/domain/garden-facts.ts` —
   collapse during summation. Weaker: the raw list stays wrong for anything that
   does not go through this function, including the rainfall chart.

Prefer 1. "One day, one total" is a property of the data, not of one summary.

### How to know it worked

- A test at the repository level: seed several same-day rows with different
  recorded-at times, assert one row comes back and it is the newest.
- The existing watering fixtures still pass (they build `GardenFacts` directly
  and so are unaffected — which is exactly why they did not catch this).
- On `dev`: the plant panel's `daysCovered` never exceeds `windowDays`, and its
  total matches the Today panel's chart total for the same garden.
- Then re-check whether `watering.dry-spell-check@2` changes its mind for
  garden `019fcd29-ef99-720b-a64f-526eb3a3474d`.

---

## 2. Seasonal timing cannot be accepted from a browser — 3 rules stay dark

### State (VERIFIED)

The server side is complete and deployed. The web side does not exist.

Working today:

- `GET /v1/gardens/{gardenId}/seasonal-facts/awaiting-acceptance`
- `POST /v1/gardens/{gardenId}/seasonal-facts/{factId}/accept`

Both are gated by `editGardenContent` (owner and editor; a viewer is refused).
The queue lists only taxa the garden actually grows, for the garden's own
hemisphere, and reports `hemisphereKnown: false` separately so "nothing to
decide" and "cannot decide anything yet" are distinguishable.

Missing: any UI. `seasonal.sowing-window-check`,
`succession.replanting-reminder` and `rotation.crop-rotation-caution` are
therefore still blocked in every garden.

### The wording problem this creates

`apps/web/shared/localization/messages/{en,ru}-care-rules.ts` now says, under
`careRules.blocker.seasonalTimingNotAccepted`:

> "You have not accepted seasonal timing for the plants here yet. Review and
> accept it to switch these checks on."

That instruction currently cannot be followed from the application. The copy
was written for the UI that was planned next. Either build the UI or soften the
copy — leaving it is a promise the product does not keep.

### What to build

A panel listing the queue entries, each showing the taxon name and its actual
months (a list of UUIDs and month numbers is not reviewable content), with a
per-taxon accept. Per-taxon was chosen deliberately over a single "accept all":
the point of the gate is that a person saw what they signed.

Suggested home: the Today page beside the care-rules panel, since that is where
the blocker is read. Reuse `apps/web/features/care-rules/` for shape and
`apps/web/features/plant-care/queries.ts` for the query-hook pattern.

Bump `apps/web/package.json` (minor — new surface).

---

## 3. Smaller, non-blocking

- **API health reports `0.0.0-development`.** `/v1/health/ready` returns a
  placeholder version, so a deployed API build can only be identified by its
  image tag. The web app carries a real version in its header; the API does not.
  Worth aligning if build identification ever matters operationally.
- **`tasks/lessons.md`** should gain the entry from this session: _verifying a
  change against `src/` only is not verifying it._ Three suites under `tests/`
  (HTTP, DST, integration) broke on the per-garden acceptance change and were
  caught by CI, not locally. `pnpm --filter @verdery/api test` runs everything;
  `npx vitest run src/` does not.

---

## Deployed state at handoff

Web **0.5.0** on `dev`. Verified live:

- Weather and rainfall reach the garden; **4 of 7 rules run** (watering,
  observation, harvest, frost).
- The three seasonal rules are blocked, correctly, pending item 2.
- The plant page shows a CARE panel with the water balance, subject to item 1.

Gates at the last commit: 378 files / 3035 tests (API, including every
testcontainer suite), 1271 web tests, lint, typecheck, format, and the 600-line
file-size check all pass.
