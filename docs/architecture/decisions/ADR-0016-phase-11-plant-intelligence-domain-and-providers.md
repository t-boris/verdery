# ADR-0016: Phase 11 Domain Freeze — Actual/Candidate Semantics, Health-Suggestion Safety, and Provider Mapping

> Status: Accepted
> Date: July 29, 2026

## Context

`docs/architecture/plant-intelligence-and-visual-journal.md` ("the design doc") already lays out
Phase 11's product direction at the owner's request: actual-versus-candidate plant semantics, a
licensed taxon knowledge profile, garden-specific candidate suitability, a repeat-photo visual
journal, and uncertain health suggestions. Its own header calls it "Draft 0.1" with "provider
contracts remain implementation-time decisions" — this ADR is that implementation-time decision,
required before `P11-DATA-01`/`P11-DATA-02` (implementation-plan.md section 20.3) can be built
without duplicating or forking architecture three earlier phases already built:

- **P4** built `plants_inventory.plant` (actual specimens; `individual`/`row`/`group` tracking
  granularity already exists as `GroupingKind`), `plant_photo`, `plant_identification`, the
  `plant_revision` journal, and `plants_inventory.taxonomy_reference` (the stable application
  taxonomy identity `AddPlant`/`ConfirmPlantIdentification` already resolve against — read-only,
  no write path, seeded/fixture content only). `observations_history.observation`,
  `observation_photo`, and `image_analysis_result` (condition/health suggestions, `requires_
confirmation boolean NOT NULL DEFAULT true`) also date to P4.
- **P7-INT-02** built `integrations.plant_taxonomy_mapping` (provider taxon ID → stable
  `taxonomy_reference_id`, `unverified → verified → rejected`, at most one live mapping per
  provider per taxon) and `integrations.plant_content_record` (append-only licensed text content:
  description/care guidance, source/version/license/attribution/jurisdiction) behind a
  provider-neutral port (`plant-content-provider.ts`) and registry
  (`plant-content-provider-registry.ts`). Both tables are live schema with **zero registered
  adapters** — `RefreshPlantContentConfiguration.activeProviderKey` is `null` in every environment
  today, a fully honest "no provider configured" state, not a stub.
- **ADR-0013** (July 26, after the P7-INT-02 migration) recorded that `P0-PROV-01` **selected**
  free-only plant-content sources: World Flora Online for the taxonomy spine, USDA PLANTS for
  United States names and native/noxious/invasive status, USDA Characteristics for care
  attributes, Wikidata and USDA GRIN for cultivars, and self-hosted hardiness-zone rasters — and
  fixed the extraction-and-review authoring model (extraction from a licensed source, or a
  human-reviewed AI proposal; edibility/toxicity/chemical guidance excluded from AI authoring
  entirely, structurally, not by reviewer instruction). No adapter implementing any of these
  selections exists yet — the registry from the previous bullet is still empty.
- **P9D-SEASON-DATA-01** added `plants_inventory.taxonomy_seasonal_fact` (per-hemisphere sowing/
  transplant/harvest timing) with an `authoring_method` (`human_authored` /
  `ai_extracted_from_source` / `ai_proposed_reviewed`) and `review_status` gate that is ADR-0013's
  policy made columns — the direct precedent for Phase 11's own fact-assertion review gate.
- **P10 / ADR-0015** built real, tested, kill-switched Vertex AI adapters for photo-based species
  identification and condition analysis (`identify-plant-species.ts`, `analyze-plant-condition.ts`),
  reachable from real screens on both clients. Toxicity/edibility fields are structurally absent
  from both ports' request/response types.

Building Phase 11 without reading the above would very likely re-derive `taxonomy_reference` as a
new `plant_taxon` table, re-derive `plant_taxonomy_mapping` as a new `plant_taxon_external_
identifier` table, and re-litigate a provider selection ADR-0013 already made. None of that is
warranted; this ADR fixes the mapping so `P11-DATA-01`/`02` extend existing schema by name.

## Decision

### 1. Actual-versus-candidate glossary (freezes design doc sections 2–4, unchanged)

The design doc's glossary is adopted verbatim as Phase 11's binding vocabulary: **actual plant**
(one known specimen, row, or tracked group that exists in the garden — `plants_inventory.plant`,
unrenamed), **candidate** (a plant being considered, not present — a new sibling table, not a
status value on `plant`; a candidate is excluded from inventory counts, current-care tasks, and
"what grows here" claims by construction, not by a filtered query a future bug could drop), and
**conversion** (an explicit, idempotent, revision-aware command that creates an actual plant,
records the planting/acquisition event, and leaves the original candidate linked as converted —
never deleted, never silently demoting an actual plant back to candidate). `PlantStatus` (`active
| dormant | archived | removed | dead`) and `GroupingKind` (`individual | row | group`) are reused
unchanged for the actual side; a candidate gets its own, smaller lifecycle (see `P11-DATA-01`).

### 2. Health-suggestion safety (freezes design doc section 9)

`observations_history.image_analysis_result` already encodes the two non-negotiable invariants —
`requires_confirmation boolean NOT NULL DEFAULT true` and no toxicity/edibility column exists or
may exist (ADR-0013's exclusion, applied structurally here too). Phase 11 **extends this table**
(additive columns: model/prompt version, evidence summary, missing-evidence/requested-views,
alternative explanations, safety class, disposition and its timestamp) rather than creating a
parallel `plant_health_suggestion` table — same aggregate, same FK from `observation_photo`, same
P10 write path (`analyzePlantCondition`/`attachObservationPhotos`). A rename is cosmetic and not
worth an expand/contract cycle; the design doc's term "health suggestion" is the product-facing
name for what this table has stored since P4.

### 3. Provider mapping — extend, do not fork

| Design doc concept                                                                   | Physical table                                                                   | Disposition                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plant_taxon`                                                                        | `plants_inventory.taxonomy_reference`                                            | Extend additively (e.g. `rank`) as needed. Remains the one stable application taxonomy identity; never duplicated.                                                                                                                                                                                              |
| `plant_taxon_name` (synonyms, localized names)                                       | none yet                                                                         | New table, owned by a new `plant-catalog` module (§4): one row per (taxon, name kind, locale).                                                                                                                                                                                                                  |
| `plant_taxon_external_identifier`                                                    | `integrations.plant_taxonomy_mapping`                                            | Reuse unchanged. Already provider-key + provider-taxon-id + verification lifecycle, at most one live row per pair.                                                                                                                                                                                              |
| `plant_source_record` (licensed text)                                                | `integrations.plant_content_record`                                              | Reuse unchanged for description/care-guidance prose.                                                                                                                                                                                                                                                            |
| `plant_fact_assertion` (structured facts)                                            | none yet                                                                         | New table in `integrations`, sibling to `plant_content_record`: typed key/value assertions (hardiness, soil, phenology window, regulatory status) with the same append-only, source-carrying shape, plus `taxonomy_seasonal_fact`'s `authoring_method`/`review_status` gate generalized beyond seasonal timing. |
| `plant_distribution_assertion`                                                       | none yet                                                                         | New table in `integrations`, same shape as fact assertions, geography-scoped.                                                                                                                                                                                                                                   |
| `plant_media_asset`                                                                  | none yet                                                                         | New table; licensed image metadata (organ/stage classification, license, attribution) referencing `media.media_record` once ingested, per the media module's existing ownership of Cloud Storage bytes.                                                                                                         |
| `plant_profile_version`                                                              | none yet                                                                         | New table, owned by `plant-catalog`: the materialized, source-priority-resolved, cited read projection assembled from the rows above. Never the write target of enrichment itself.                                                                                                                              |
| `garden_plant`                                                                       | `plants_inventory.plant`                                                         | Unchanged (§1).                                                                                                                                                                                                                                                                                                 |
| `garden_plant_candidate`, `candidate_suitability_assessment`, `candidate_conversion` | none yet                                                                         | New tables in `plants-inventory` (`P11-DATA-01`).                                                                                                                                                                                                                                                               |
| `plant_observation*`                                                                 | `observations_history.observation`, `observation_photo`, `image_analysis_result` | Extend additively (§2 and `P11-MEDIA-01`'s typed measurement/symptom columns).                                                                                                                                                                                                                                  |

A new top-level `plant-catalog` module owns taxon-name search projections and the materialized
profile version; it reads `plants_inventory.taxonomy_reference` and `integrations`' provider tables
through narrow ports (the established cross-module read-port pattern —
`client-media-entitlement-source.ts` is the precedent), never by importing another module's
repository class. `integrations` keeps owning every raw provider-fact ledger and the adapter
registry, unchanged from its P7 role, just with more tables and (per §5) real adapters.

### 4. Provider selection: ADR-0013's list is binding; four classes are new

Taxonomy, US names/status, care attributes, cultivars, and hardiness already have a selected
source per ADR-0013 — Phase 11 does not reopen that choice. Four knowledge classes the design doc
adds beyond ADR-0013's original scope get their own free/public selection now, all US federal or
public-domain/open-data sources requiring no commercial license or owner sign-off:

| Knowledge class                                         | Source                              | Treatment                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Occurrence evidence                                     | GBIF                                | Occurrence source, quality, date, spatial uncertainty, citation preserved; never used to infer garden suitability directly. |
| Phenology (beyond P9D's authored seasonal-timing facts) | USA-NPN                             | Phase/time/geography/evidence-quality/sample context stored as fact assertions.                                             |
| Soil context                                            | USDA NRCS                           | Marked as modeled/mapped estimate, never garden-measured fact.                                                              |
| Federal/state regulatory                                | USDA APHIS + reviewed state sources | Versioned; rechecked before presenting a regulatory claim.                                                                  |

Identification (photo → species candidate) reuses the already-built, already-kill-switched P10
Vertex AI adapter (`identify-plant-species.ts`) — no new provider decision.

### 5. Build real, ship kill-switched — the ADR-0015 pattern, applied here

Every adapter above is buildable today without a commercial contract: all eight sources (World
Flora Online, USDA PLANTS, USDA Characteristics, Wikidata, USDA GRIN, hardiness rasters, GBIF,
USA-NPN, USDA NRCS, USDA APHIS) are free, public, or public-domain. `P11-PROV-01` and
`P11-ASYNC-01` build real adapters against the existing `PlantContentProviderAdapter` port (text
content) and a new equivalent port for structured fact/distribution assertions, registered in the
existing registry, each behind its own default-`false` kill-switch — the same
`PLANT_SPECIES_AI_ENABLED` idiom, not a new posture. `RefreshPlantContent`'s synchronous
on-demand-with-refetch-window shape is reused as-is for the single-taxon case; `P11-ASYNC-01` adds
genuinely new Cloud Tasks/Cloud Run Job machinery (ADR-0006) only for the deduplicated,
multi-knowledge-class enrichment sweep the design doc's section 6 describes — it does not replace
`RefreshPlantContent`, it calls the same provider ports from a job instead of a request.

**What stays a genuine owner-only gate, not built around:** licensing a commercial Cooperative
Extension or contracted plant-content vendor (design doc section 5's optional row, beyond the free
baseline) remains undecided and unbuilt until the owner chooses to pursue it — the free-source
profile ships without it, visibly partial where a paid source would have filled a gap, exactly as
"the product shows partial knowledge... rather than fabricated facts" (design doc, section 20.2)
requires. Evaluating health suggestions against real garden photos (implementation-plan.md section
20.2's fourth bullet) and confirming Vertex AI's image data-retention terms remain the same two
owner actions ADR-0015 already deferred for Phase 10 — not re-litigated per capability.

### 6. Media license allowlist (freezes design doc section 7)

Public Domain, CC0, and CC BY are approved for product presentation today. CC BY-SA requires an
approved compliance design before use (share-alike obligations are not yet analyzed for a
commercial product). CC BY-NC, no-derivatives licenses, unknown licenses, and withdrawn media are
never eligible. `plant_media_asset` (§3) stores the license on every row; presentation code must
reject ineligible licenses structurally (a closed enum, not a runtime string check a future value
could silently pass).

## Consequences

- `P11-DATA-01`/`02` migrations extend six existing tables and add new ones only where the design
  doc names a concept nothing above already covers — no duplicate identity table, no re-fork of
  the provider registry.
- `P11-PROV-01` is implementation work (writing real adapters against an already-selected list),
  not a new selection decision — it does not block on owner availability the way Phase 10's photo-
  object-capture research gate did.
- The `plant-catalog` module becomes the fourth reader of `taxonomy_reference` (alongside
  `plants-inventory`, `integrations`, and now itself) — all through the read-port pattern, so
  `taxonomy_reference`'s single write-owner posture (still no `CreateTaxonomyReference` command)
  is unchanged by this ADR.
- Commercial-provider and health-suggestion real-world evaluation remain visible, tracked gaps —
  not silently dropped, not blocking the free-source build.

## Rejected Alternatives

- **A new `plant_taxon` identity table, separate from `taxonomy_reference`:** rejected. Would fork
  the one identity `AddPlant`/`ConfirmPlantIdentification`/`plant_taxonomy_mapping` already resolve
  against, requiring a migration of every existing reference for no behavioral gain.
- **Re-run a provider bake-off for taxonomy/care/hardiness sources:** rejected. ADR-0013 already
  decided this eleven days before this ADR; reopening it without new information wastes the
  decision it recorded.
- **Wait for a commercial content vendor before building any Phase 11 provider code:** rejected,
  for the same reason ADR-0015 rejected waiting on Phase 10's photo pipeline — the free sources
  cover real, shippable value today, and provider replacement is designed to be a pure addition
  later (design doc section 16).
- **A parallel `plant_health_suggestion` table instead of extending `image_analysis_result`:**
  rejected. Same aggregate, same invariants, same FK shape; a rename with no behavioral change is
  not worth an expand/contract migration cycle.
