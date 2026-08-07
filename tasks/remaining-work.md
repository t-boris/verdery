# Remaining work — care engine

Originally written August 7, 2026 as a handoff at the point where the deployed
state was correct but incomplete. Updated the same day, after the work was
done, so this file keeps saying what is TRUE rather than what was intended.

Items 1-3 are resolved. Section 4 is what is genuinely left, including one
thing the original handoff could not have known.

---

## 1. Daily rainfall was counted more than once — RESOLVED

### What was observed

The plant care panel on `dev` rendered `175.2 mm of rain over the last 7 days`,
`Measured across 18 of 7 days`, while the Today weather panel rendered
**58.4 mm** across six dated bars for the same garden and window.

### The mechanism, now VERIFIED from code

The original hypothesis — several rows per calendar day — was right in family
and wrong in detail. It is not that the sweep re-stores the current day; it is
that **the whole recent past is re-stored on every refresh**:

- `open-meteo-weather-adapter.ts` sends `past_days=<configured>`.
- `readDaily` (`open-meteo-payload.ts`) turns every elapsed day in that block
  into an `observation` with `precipitationIntervalSeconds = 86400` and
  `effectiveAt` at UTC midnight — byte-identical across fetches.
- `refresh-garden-weather.ts` inserts the whole batch whenever the refresh is
  not a fresh cache hit, and the table is append-only.

So the stored rows are `fetches × days` and the sum is `fetches × true total`.
Three sweeps explains 18 rows over 6 days and 175.2 = 3 × 58.4 exactly.

The handoff's second open question — why the Today panel showed the right
figure — has a duller answer than expected: **nothing collapses per day
anywhere.** Both surfaces read through `GetGardenPrecipitation`. The weather
panel was simply read when fewer sweeps had landed. There was no second
implementation to find.

### The fix

`KyselyWeatherRecordRepository.listElapsedPrecipitation` now returns one row
per PERIOD — `DISTINCT ON (effective_at)` ordered `fetched_at desc, created_at
desc, id desc`, the same precedence `findLatest` uses for contradictory
records. In the shared read, so all three consumers (rule engine, plant care
view, weather panel) are correct by construction.

Not a truncation to the calendar day, deliberately: this read is parameterised
by `intervalSeconds`, and collapsing hourly totals per day would discard
twenty-three hours of rain. For the daily class the two coincide.

`InMemoryWeatherRecordRepository` mirrors it. A double that returned every row
would let a caller pass while production double-counted, which is how this
survived in the first place.

Covered by `tests/integration/integrations-weather.test.ts` (real PostgreSQL:
three sweeps of two days collapse to two entries carrying the newest figures,
hourly rows in the same window stay separate, all eight rows remain as
history) and by a `GetGardenWeatherView` unit test.

---

## 2. Seasonal timing can now be accepted from a browser — RESOLVED

`SeasonalAcceptancePanel` sits on the Today page directly under the care-rules
disclosure that names the blocker. One entry per taxon the garden grows, with
the taxon's name and its actual months, its licensed source when it has one,
and an explicit "not reviewed by a horticulturist" pill when it lacks sign-off.

Per taxon with no "accept all", as specified — the gate exists so that a person
saw what they signed. No reject, because timing this garden has not accepted is
already invisible to the rules. A viewer is refused the queue by
`editGardenContent`, and the panel renders nothing at all for them rather than
showing buttons they cannot press.

The two endpoints now have a contract (`SeasonalAcceptance` tag), so the web
client is generated against the same document as everything else. The queue
item nests its months as the same `SeasonalPlanTaxonomyTiming` the seasonal
plan renders, which reshaped the deployed response — see `tasks/todo.md`'s
review section for why that was preferred to a second month vocabulary.

The care-rules copy that promised this ("Review and accept it") now says
"Accept it below", in both locales.

### What building it uncovered — a blocker that predated the UI

The first run of the first HTTP test failed: the accept endpoint returned
`400` for a fact id the queue had just handed it. `factId` was validated
against the version-7 `UUID_PATTERN`, and `taxonomy_seasonal_fact` rows are
seeded by SQL migration with `gen_random_uuid()` — version 4. **Every real
fact was rejected**, so the gate could not have been passed from any client at
all, with or without a UI. "The server side is complete and deployed" was
wrong, and nothing in the repository could have said so: the routes had no
HTTP-level test.

The same pattern was applied to `taxonomyReferenceId`, so `POST /plants` also
rejected every taxon `GET /taxonomy-references` returns. That is upstream of
this whole feature: a garden whose plants cannot carry a seeded taxon has an
empty acceptance queue regardless.

Fixed once, at the root: `CatalogUuid` in the contract and
`CATALOG_UUID_PATTERN` in transport, for ids that name shared catalog content.
A UUID's version is a property of who minted it.

---

## 3. Smaller — RESOLVED

- **API health reports the deployed build.** `deploy-api.sh` and
  `deploy-workers.sh` set `SERVICE_VERSION` to the tag of the image they were
  handed, which CI builds as the commit SHA. `0.0.0-development` in a live
  response now means the schema default applied, which is a deployment defect
  rather than the expected value. GA gate 4 and service-levels M6 are closed.
- **`tasks/lessons.md`** gained the `src/`-only verification entry, plus two
  more this session earned: fixtures must mint ids the way production does,
  and a route with no client is unobserved rather than complete.

---

## 4. What is actually left

- **Re-check `watering.dry-spell-check@2` for garden
  `019fcd29-ef99-720b-a64f-526eb3a3474d` after this deploys.** The 58.4 mm
  figure in the original handoff was already the de-duplicated total against a
  25 mm norm, so the rule's silence was most likely correct — but that has not
  been re-read from the database, and the failure direction (under-firing on a
  dry garden) is the one that costs a plant.
- **Audit the rest of the contract for seeded-content ids.** Only the ids that
  cross a validating boundary were changed. Other `Uuid`-typed fields may name
  rows a SQL migration minted; nobody has enumerated them.
- **`SERVICE_VERSION` is a commit SHA, not a semantic release identifier.** A
  build is now identifiable, which is what the gates needed. When tagged
  releases exist, the tag is what the deploy scripts should be handed.
- **The three seasonal rules have not yet been seen firing.** The panel makes
  acceptance possible and the tests prove the mechanics; nobody has accepted a
  taxon on `dev` and watched a sowing-window recommendation appear. That is the
  first thing to do after the next deploy.

---

## Gates at this handoff

379 files / 3045 tests (API, including every testcontainer suite), 1280 web
tests, 34 contract tests, 152 workers tests, lint, typecheck, format, and the
600-line file-size check all pass. The API suite was run as
`pnpm --filter @verdery/api test`, not a `src/`-scoped approximation.
