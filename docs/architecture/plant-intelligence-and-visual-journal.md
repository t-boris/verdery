# Plant Intelligence, Candidates, and Visual Journal Design

> Status: Draft 0.1; product direction requested by the owner; provider contracts remain implementation-time decisions  
> Last updated: July 28, 2026

## 1. Purpose

This document defines how Grow Garden represents plants that are already present and plants being
considered, builds a licensed and source-attributed plant knowledge profile, records repeated
photographic observations of the same plant, supports visual progress and health review, and
delivers the complete workflow on native Apple and web clients.

It extends the existing plants-inventory, observations-history, media, integrations,
recommendations, search, synchronization, and client-publication boundaries. It does not create a
second plant database or make an external provider authoritative for accepted garden state.

## 2. Product Outcomes

The design must let a user:

- Add an actual plant that exists in the garden.
- Add a candidate that is being considered for the garden.
- Search and filter both kinds without confusing planned presence with actual presence.
- Evaluate a candidate against a proposed garden location and convert it to an actual plant after
  planting while preserving history.
- Open a visually rich plant profile with licensed images, concise icon-led facts, provenance, and
  visible uncertainty.
- Photograph the same actual plant repeatedly and compare its progress over time.
- Record growth, phenology, condition, symptoms, work, and notes alongside photographs.
- Receive explicitly uncertain health suggestions that never become confirmed diagnoses or
  treatments without user review.
- Share selected progress and result media through the existing client-publication boundary without
  exposing internal observations automatically.

## 3. Domain Separation

### 3.1 Taxon Knowledge Profile

A taxon knowledge profile is shared reference knowledge about a botanical taxon or cultivar. It may
contain:

- Accepted scientific name, synonyms, common names, rank, family, and external identifiers.
- Native, introduced, and observed distribution assertions.
- Life cycle, growth habit, mature dimensions, and horticultural requirements.
- Seasonal and phenological assertions scoped by geography and climate.
- Regulatory, invasive, toxicity, and edibility assertions only from approved reviewed sources.
- Licensed representative media classified by plant part and development stage.
- Source, jurisdiction, license, attribution, retrieval time, confidence, and review state for every
  material assertion.

The profile is not garden inventory and is not copied for every occurrence of the same taxon.

### 3.2 Actual Plant

An actual plant represents one known specimen, a row, or a tracked group that exists in the garden.
It owns or references:

- Stable garden plant identity.
- Placement or garden-area association.
- Quantity and tracking granularity.
- Planting, sowing, acquisition, or first-observed date.
- Lifecycle, current condition, and archive/removal state.
- User observations, measurements, tasks, and visual journal.

Unknown and partially identified actual plants remain valid.

### 3.3 Candidate

A candidate represents a plant being considered, not a plant currently present. It may have:

- Desired garden, area, or proposed map placement.
- Desired quantity or grouping.
- User rationale, priority, notes, price, and purchase source.
- Suitability assessment and blockers for the proposed location.
- Alternative candidates.

A candidate is excluded from actual inventory counts, current-care tasks, and claims about what
grows in the garden.

### 3.4 Candidate Conversion

Conversion to an actual plant is an explicit revision-aware command. It:

1. Preserves candidate evaluation and decision history.
2. Creates the actual plant identity and accepted placement.
3. Records the planting or acquisition event.
4. Starts, but does not fabricate, an observation history.
5. Leaves the original candidate record linked as converted rather than deleting it.

Actual plants are not silently demoted to candidates. Removing an actual plant uses the existing
lifecycle and archival model.

## 4. Data Model

PostgreSQL remains the synchronized source of truth. The logical model includes:

```text
plant_taxon
plant_taxon_name
plant_taxon_external_identifier
plant_source_record
plant_fact_assertion
plant_distribution_assertion
plant_media_asset
plant_profile_version

garden_plant
garden_plant_candidate
candidate_suitability_assessment
candidate_conversion

plant_observation
plant_observation_measurement
plant_observation_symptom
plant_observation_media
plant_health_suggestion
```

External assertions are append-oriented and source-specific. A materialized profile version chooses
display assertions according to approved source priority, geographic relevance, freshness, review
state, and conflict policy without deleting competing source assertions.

Cloud Storage stores original media and derivatives. PostgreSQL stores stable media identity,
authorization, checksums, processing state, observation association, provenance, license, and
retention state. Signed URLs are never permanent identifiers.

## 5. Plant Knowledge Sources

Provider selection remains adapter-based and license-gated. The initial United States source
evaluation covers:

| Knowledge class                | Preferred source class                                            | Required treatment                                                           |
| ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accepted taxonomy and synonyms | WCVP/POWO, ITIS, USDA PLANTS                                      | Maintain an external-ID crosswalk and source version                         |
| Native and introduced range    | WCVP/POWO and USDA PLANTS                                         | Keep asserted status and geography; do not infer garden suitability          |
| Occurrence evidence            | GBIF and licensed iNaturalist datasets                            | Preserve occurrence source, quality, date, spatial uncertainty, and citation |
| Horticultural care             | Licensed Cooperative Extension or contracted plant-content source | Scope by geography and cultivar; do not scrape without permission            |
| Phenology                      | USA-NPN and licensed occurrence annotations                       | Store phase, time, geography, evidence quality, and sample context           |
| Hardiness and climate          | USDA hardiness data and approved weather/climate sources          | Keep garden context separate from species requirement assertions             |
| Soil context                   | USDA NRCS or another approved source                              | Mark modeled or mapped soil as estimated local context                       |
| Federal and state restrictions | USDA APHIS and reviewed state sources                             | Version and recheck before presenting a regulatory claim                     |
| Identification                 | Evaluated image-identification provider                           | Return ranked suggestions; require user confirmation                         |

Public availability does not imply commercial reuse permission. Bulk downloads, APIs, partnership
exports, or licensed feeds are preferred over page scraping.

## 6. Enrichment Lifecycle

Adding a plant or candidate never waits for all external providers. The accepted garden mutation
commits first, and a deduplicated enrichment request is created for the canonical taxon or unresolved
identity.

Profile enrichment states are:

- `not_requested`
- `queued`
- `resolving_identity`
- `collecting`
- `partial`
- `ready`
- `needs_review`
- `failed_retryable`
- `failed_terminal`

The asynchronous pipeline:

1. Resolves the accepted taxon or presents ambiguous candidates.
2. Fetches permitted source records through provider adapters.
3. Normalizes source assertions without losing original provenance.
4. Rejects media that fail license or attribution policy.
5. classifies eligible media by organ, development stage, season, and confidence.
6. Builds a cited profile version and search projection.
7. Recalculates garden-specific suitability separately.
8. Refreshes expiring sources according to source policy and usage.

Jobs are deduplicated by taxon, cultivar scope, requested knowledge classes, and source-version
window. Adding another specimen reuses the profile and does not fan out duplicate provider calls.

## 7. Life Cycle and Representative Media

Annual, biennial, and perennial are life-cycle assertions, not three required specimen photographs.
Life cycle may be climate-conditional and may differ from horticultural use.

Representative media use explicit categories:

- Seed.
- Seedling.
- Juvenile.
- Mature habit.
- Leaf.
- Stem or bark.
- Bud.
- Flowering.
- Fruiting.
- Seed production.
- Senescent.
- Dormant.
- Natural habitat.

Species-level media must not be labeled as a specific cultivar. A stage or organ inferred by a model
is marked as inferred until reviewed. Each asset retains creator, rights holder, license,
attribution, source record, observed time and generalized location when permitted, and any derived
environmental context.

The initial commercial-media allowlist is Public Domain, CC0, and CC BY. CC BY-SA requires an
approved compliance design. CC BY-NC, incompatible no-derivatives use, unknown licenses, and
withdrawn media are not eligible for product presentation.

## 8. Visual Plant Journal

### 8.1 Observation Unit

Each journal entry is an append-oriented plant observation tied to the stable actual plant identity.
It may contain:

- Capture time and author.
- One or more purpose-labeled photographs.
- Phenological stage.
- Height, width, count, or other typed measurements.
- Condition rating and structured symptoms.
- User notes.
- Relevant watering, treatment, or task references.
- Weather and garden-context snapshot with source and quality.
- Model suggestions and their version, confidence, and review outcome.

Corrections amend an observation through a new record or explicit amendment; they do not rewrite
historical evidence silently.

### 8.2 Guided Capture

The capture UI offers optional shot purposes:

- Whole plant.
- Leaf front.
- Leaf back.
- Stem or bark.
- Flower.
- Fruit.
- Symptom close-up.
- Context or free-form view.

Ordinary progress capture requires only the minimum useful view. A health-analysis flow can request
additional views. The native client may overlay the previous comparable image to help reproduce
framing. AR-assisted repeat positioning is optional future enhancement and is not required for the
initial journal.

### 8.3 Media Processing

Uploads follow the existing resumable media protocol and support offline native capture. Processing
creates:

- Verified retained original.
- Orientation-corrected presentation derivative.
- Responsive web and native derivatives.
- Thumbnail.
- Perceptual and cryptographic hashes for duplicate detection.
- Safe metadata projection with sensitive EXIF removed from presentation derivatives.

Original EXIF location is retained only when policy, consent, and product need allow it. Client
publication never exposes precise source coordinates by default.

### 8.4 Progress Views

The same journal data supports:

- Chronological photo timeline.
- Before-and-after comparison.
- Matched-view overlay.
- Stage and symptom filters.
- Measurement charts.
- Time-lapse generated from selected images.
- Correlation with tasks, watering, treatment, and weather events.

Generated time-lapse files are derivatives with their own retention and publication entitlement.

## 9. Health Suggestions

Image analysis produces a `plant_health_suggestion`, not a confirmed diagnosis. It contains:

- Candidate issue.
- Confidence and model version.
- Visible evidence summary.
- Missing evidence and requested additional views.
- Alternative explanations.
- Safety class.
- User disposition: confirmed externally, accepted as observation, rejected, or unresolved.

The model cannot directly populate toxicity, edibility, pesticide, treatment, or regulatory facts.
High-impact treatment recommendations remain rules-first and require reviewed evidence under the
recommendation safety policy. The UI consistently uses uncertainty language and provides a manual
observation path when analysis is unavailable.

## 10. Suitability Assessment

Candidate suitability is a versioned assessment derived from source-attributed plant requirements
and garden context. It may evaluate:

- Hardiness compatibility.
- Sun and shade.
- Soil, pH, drainage, and moisture.
- Available mature space.
- Container, greenhouse, or open-ground context.
- Conflicts with structures, paths, utilities, and neighboring plants.
- Invasive or regulatory restrictions.
- User-declared child, pet, pollinator, edible-garden, and maintenance preferences.

The result separates blockers, cautions, matches, unknowns, and assumptions. Missing context never
becomes a positive match. Suitability is advisory and does not prove that a plant will thrive.

## 11. API Surface

The detailed OpenAPI contract uses the existing authorization, idempotency, revision, pagination,
error, media, and synchronization conventions. Required resource families include:

```text
GET    /v1/plant-catalog/search
GET    /v1/plant-catalog/taxa/{taxonId}
GET    /v1/plant-catalog/taxa/{taxonId}/media

GET    /v1/gardens/{gardenId}/plants
POST   /v1/gardens/{gardenId}/plants
GET    /v1/gardens/{gardenId}/plant-candidates
POST   /v1/gardens/{gardenId}/plant-candidates
POST   /v1/gardens/{gardenId}/plant-candidates/{candidateId}/convert

GET    /v1/gardens/{gardenId}/plants/{plantId}/journal
POST   /v1/gardens/{gardenId}/plants/{plantId}/observations
POST   /v1/gardens/{gardenId}/plants/{plantId}/observations/{observationId}/media
POST   /v1/gardens/{gardenId}/plants/{plantId}/observations/{observationId}/health-analysis

GET    /v1/gardens/{gardenId}/plant-candidates/{candidateId}/suitability
POST   /v1/gardens/{gardenId}/plant-candidates/{candidateId}/suitability/recalculate
```

Exact route naming is finalized contract-first. Large binary content continues to bypass the JSON
API through backend-authorized Cloud Storage upload sessions.

## 12. Search and Filters

Search covers accepted scientific names, synonyms, localized common names, cultivar names,
user-defined names, and approved source identifiers. Results make the matched term visible when it
differs from the displayed accepted name.

The initial filter vocabulary includes:

- Actual, candidate, or both.
- Individual, row, or group.
- Garden area and map placement state.
- Known, partially identified, or unknown.
- Lifecycle and phenological stage.
- Current health or unresolved symptom.
- Native, introduced, invasive, or regulated.
- Annual, biennial, perennial, woody, or herbaceous.
- Light, water, soil, drainage, and hardiness compatibility.
- Flowering or fruiting period.
- Data completeness and profile-enrichment state.
- Has journal entries, recent observation, or overdue observation.

Filters are represented in shareable web query state where privacy permits and in restorable native
view state. Server filtering and sorting remain authoritative for large result sets.

## 13. Visual and Interaction Design

The plant experience is image-led and icon-led, but never icon-only where meaning would be
ambiguous.

### 13.1 Plant Library

- Large image cards or compact image rows are user-selectable.
- Actual and candidate state uses a visible badge, icon, accessible label, and filter.
- Cards prioritize representative image, user name, accepted/common name, location, health or
  suitability summary, and the next meaningful action.
- Empty, loading, partial-data, failed-enrichment, unknown-plant, and no-photo states are designed
  explicitly.
- Bulk selection supports move, archive, compare, add observation, and candidate conversion where
  semantically valid.

### 13.2 Addition Flow

The first decision is:

- `Already in this garden`
- `Considering for this garden`

Users may then search the catalog, photograph a plant, select a recent image, or create an unknown
entry. The flow requests only fields required for the selected kind and tracking granularity.
Candidate placement is proposed; actual placement is accepted garden state.

### 13.3 Detail Screen

The detail screen uses:

- Hero image or user-photo carousel.
- Actual/candidate status and primary action.
- Icon fact strip for light, water, hardiness, size, life cycle, bloom, and risk indicators.
- Contextual suitability or current-condition panel.
- Tabs or sections for Overview, Care, Journal, Tasks, Distribution, and Sources.
- Visible attribution, confidence, geographic scope, last refresh, and conflicting-source notices.

Icons always have accessible names, tooltips or adjacent labels, selected/disabled states, and
non-color cues. Images have useful alternative text and do not become the only carrier of status.

### 13.4 Journal Capture and Review

The native flow is camera-first and thumb-reachable. The web flow supports camera input where the
browser permits it and file upload otherwise. Both surfaces support observation editing, progress
comparison, health-review states, and source media access. Native additionally supports durable
offline drafts and background upload.

## 14. Synchronization and Concurrency

Actual plants, candidates, conversions, observations, amendments, and media metadata use the
application-owned synchronization model. Native local state includes pending journal observations
and upload references.

Candidate conversion is idempotent and revision-aware. Two concurrent conversions cannot create two
actual plants. Observation creation uses client-generated UUIDv7 identifiers. Media upload can
complete before or after the observation command without losing association, and abandoned uploads
follow media cleanup policy.

Taxon knowledge profiles are reference projections delivered through versioned reads and cached
locally. They are not inserted into the operational mutation outbox as user-authored garden state.

## 15. Sharing and Privacy

Operational owner/editor/viewer authorization applies to actual plants, candidates, and journals.
Candidates and internal suitability notes are not client-visible by default.

Client access requires an immutable publication plus explicit media entitlement. A publisher may
select:

- Result observation summary.
- Selected before-and-after images.
- Selected progress timeline items.
- Generated time-lapse derivative.

Health suggestions, private notes, precise coordinates, original EXIF, unpublished images, provider
diagnostics, and rejected analysis are excluded unless a future explicit publication policy
authorizes a safe projection.

## 16. Reliability, Cost, and Provider Failure

- Plant addition and journal capture remain available when providers fail.
- Enrichment failures produce partial profiles and explicit retry state.
- Provider calls use quotas, timeouts, caching, circuit breaking, and source-specific backoff.
- Bulk reference ingestion is scheduled and versioned rather than performed per user request.
- Media derivatives and AI analysis have account and environment budgets.
- Disabling enrichment or health analysis never hides accepted garden records or user media.
- Provider replacement does not change stable application taxon, plant, candidate, or observation
  identifiers.

## 17. Observability

Privacy-safe telemetry covers:

- Actual-versus-candidate additions.
- Search success, zero results, filter use, and abandoned add flows.
- Identification ambiguity and confirmation outcomes.
- Enrichment duration, partial coverage, source errors, and license rejection.
- Candidate suitability review and conversion.
- Journal capture completion, upload recovery, duplicate detection, and comparison use.
- Health-suggestion request, additional-view request, disposition, and model fallback.
- Media processing latency, derivative failure, storage growth, and publication access.

Telemetry excludes raw media, exact location, notes, diagnosis content, common-name search text when
it may be sensitive, signed URLs, and direct personal identifiers.

## 18. Testing

Required automated and manual evidence includes:

- Domain invariants for actual plants, candidates, and conversion.
- Source-assertion conflict, refresh, provenance, citation, and license fixtures.
- Search relevance and complete filter combinations with authorization and query-plan checks.
- Resumable and offline journal capture, process termination, duplicate upload, and convergence.
- Media verification, EXIF removal, derivatives, retention, deletion, export, and entitlements.
- Web responsive and native device tests for add, list, search, filters, detail, capture, timeline,
  comparison, and health review.
- Accessibility tests for icons, images, focus order, Dynamic Type, VoiceOver, keyboard, contrast,
  reduced motion, and non-color status.
- Model refusal, malformed response, uncertain result, false-positive review, provider timeout, and
  kill-switch behavior.
- Candidate-to-actual cross-client end-to-end tests.
- Client-publication isolation and withdrawal tests for progress media.

## 19. Completion Criteria

- Every add surface requires an explicit actual-versus-candidate choice or inherits it from an
  unambiguous entry point.
- Actual plants and candidates cannot be confused in inventory, map, tasks, search, analytics, or
  client publication.
- A candidate can be evaluated and converted without losing history.
- Plant profiles show source, geography, freshness, uncertainty, and media attribution.
- A user can repeatedly photograph the same stable plant identity on native and web.
- Native capture works offline and resumes upload without duplicate observations.
- The journal supports timeline, before/after comparison, stage filters, and measurements.
- Health output remains a suggestion requiring review and cannot bypass safety policy.
- Search and filters cover the full plant-library and journal workflow.
- Image-led and icon-led interfaces remain accessible and usable without color or image recognition.
- Provider, media, synchronization, deletion, export, sharing, cost, and failure evidence pass the
  Phase 11 release gate.
