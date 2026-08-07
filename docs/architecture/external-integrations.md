# External Integrations Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines provider adapters, normalized data, reliability, security, licensing, caching, and replacement rules for weather, maps, imagery, geocoding, plant content, AI, and messaging providers.

## 2. Integration Boundary

Every provider is accessed through an application-owned port and adapter:

```text
domain/application
       │
       ▼
provider-neutral port
       │
       ▼
provider adapter
       │
       ▼
external API
```

Provider SDK and payload types remain inside the adapter.

## 3. Adapter Contract

Each adapter defines:

- Purpose-specific input and normalized output.
- Authentication method.
- Timeout and retry policy.
- Rate and quota limits.
- Cache and freshness rules.
- Failure classification.
- Data classification and allowed fields.
- Provider region and subprocessors.
- Attribution and licensing requirements.
- Cost metrics.
- Replacement and export considerations.

## 4. Provider Registry

Configuration maps an integration capability to one active adapter per environment. Runtime multi-provider routing is avoided initially unless a use case requires fallback and equivalent semantics are proven.

Provider selection changes through configuration plus compatibility tests; it does not change domain records silently.

## 5. Weather

Normalized weather data records:

- Location or grid reference.
- Observation/forecast effective time.
- Retrieval time.
- Provider.
- Temperature, precipitation, wind, humidity, and approved derived values.
- Units and conversion provenance.
- The accumulation interval a precipitation figure covers, when the provider documents one. Null
  where it does not, and null is never read as an assumed hour or day: rows without a recorded
  interval take part in no sum. Open-Meteo reports both an hourly `current.precipitation` and a
  daily `precipitation_sum`, so recording the interval is what keeps a weekly total from counting
  the current hour twice.
- Confidence or provider quality where supplied.
- License and redistribution constraints.

Recommendations check freshness and degrade when data is stale.

**Reading the stored records.** `GET /gardens/{gardenId}/weather` exposes the latest observation and
forecast to an authorized garden reader, with the freshness label derived at read time and the
record's own snapshotted attribution. The read never calls a provider — refreshing is exclusively the
scheduled sweep's job — so a person reloading a page cannot spend quota, and the surface is
unaffected by a provider outage. When no reading exists the response carries a typed reason
(`noProviderConfigured`, `gardenNotGeoreferenced`, `notYetFetched`) rather than an empty body,
because only one of those three is something the reader can act on.

### 5.1 Selected Provider

**Open-Meteo** (paid Standard plan) is the selected weather provider, decided July 26, 2026 — the weather half of `P0-PROV-01`. **NWS / api.weather.gov** is the named fallback provider and is not implemented; adding it is one adapter class plus one registration.

The decision was made on **retention rights, not price**. This system stores normalized weather rows permanently and append-only, and every other evaluated candidate forbids exactly that: Apple WeatherKit, Tomorrow.io, Google Weather, and WeatherAPI.com each disqualify themselves through their own terms (no persistent storage, derived-database bans, mandatory deletion TTLs, and — in one case — an explicit ban on use inside a weather application), and OpenWeather's ODbL is share-alike. Open-Meteo's CC BY 4.0 permits durable storage and redistribution with attribution.

### 5.2 Constraints That Bind The Design

| Constraint                      | Verified fact (July 26, 2026)                                                                                                                                                                             | How the design honours it                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence                         | CC BY 4.0, unchanged by the paid plan                                                                                                                                                                     | Every persisted row carries the licence in `weather_record.license_note`, snapshotted from the registry entry at write time                                                                                                                                                                                               |
| Attribution                     | "You must include a link next to any location Open-Meteo data are displayed"                                                                                                                              | The registry entry's `attribution_text` carries the required text **and** the link, and is snapshotted onto every row so clients can render it                                                                                                                                                                            |
| Mixed source licences           | The aggregator serves sources under different licences; UK Met Office data is CC-BY-SA (share-alike) and must never enter our records                                                                     | The request pins `models=ncep_hrrr_conus,ncep_nbm_conus,gfs_seamless` (NOAA only). Model pinning is a reviewed code constant, not configuration, because it decides which licence the stored data carries                                                                                                                 |
| No provider-declared issue time | The response carries `generationtime_ms`, `timezone`, `elevation`, and `daily_units`; there is no model-run timestamp and no cache headers                                                                | Freshness derives only from our own retrieval time (`weather_record.fetched_at`). No effective time is fabricated: each `effective_at` is a timestamp the provider itself sent                                                                                                                                            |
| No confidence value             | Neither Open-Meteo nor NWS supplies one on these tiers                                                                                                                                                    | `confidence` stays null; only the provider-quality label is populated                                                                                                                                                                                                                                                     |
| Recent past is model output     | `past_days` returns past **model analysis**, not gauge measurements (verified: `past_days=30&forecast_days=16` returned 46 daily rows with non-null `precipitation_sum` and `et0_fao_evapotranspiration`) | Recent-past rows are stored with the quality label `model_analysis` (`model_forecast` for a period that has not finished), so nothing implies observation                                                                                                                                                                 |
| Two hosts, two licences         | `api.open-meteo.com` needs no key and is non-commercial only; `customer-api.open-meteo.com` uses an `apikey` parameter under the paid plan                                                                | Host tier and key both come from configuration (`WEATHER_OPEN_METEO_TIER`, `WEATHER_OPEN_METEO_API_KEY`); the free tier's non-commercial restriction is written into the licence note stamped on rows fetched through it. Selecting the paid host without a key fails at startup                                          |
| Unit provenance                 | The API echoes its own unit label per variable                                                                                                                                                            | The request asks for SI explicitly (`temperature_unit=celsius`, `wind_speed_unit=ms`, `precipitation_unit=mm`); a value is accepted only when the echoed label is the requested SI label, and that echoed label is what lands in `source_units`. A mismatch drops the single measurement instead of claiming a conversion |

**Known gap in the record model.** The terms require a _link_ beside displayed data, but `weather_record` models attribution as one free-text field (`attribution_text`) with no structured attribution URL — unlike section 6's basemap requirements, which name "attribution text and URL" separately. The link therefore travels inside the attribution text. A structured `attribution_url` would need a domain change and a migration; until then, clients must render the attribution text verbatim, link included. Both clients do: the
web's conditions panel and the iOS conditions panel and plant care card each render
`attributionText` whenever they render a reading, and omit it exactly when there is no reading to
credit.

### 5.2 Geocoding and Aerial Imagery

Two United States federal services, decided together on August 4, 2026 because they answer the same
question — where a garden is, and what it looks like from above — and because both are public domain.

- **Address geocoding**: the Census Bureau geocoder (`geocoding.geo.census.gov`). Free, no key, no
  account, public-domain data. A LOOKUP only: nothing it returns is stored. A candidate is shown, a
  person accepts one, and what persists is the georeference anchor they accepted. That is what keeps
  this provider free of the retention question every commercial geocoder raises.
- **Aerial imagery**: the USGS National Map's NAIP Plus service (`imagery.nationalmap.gov`).
  Public-domain federal imagery, rendered on demand by `exportImage` — the National Map's own cached
  tiles stop at zoom 16, which is far too coarse for a garden. **0.30 m per pixel**, which is the
  service's own `pixelSizeX` read from `?f=json` on August 5, 2026; an earlier "roughly 0.6–1 m"
  here was an estimate and it was wrong by a factor of two, which is why the client now asks the
  service rather than a memory. A house, a driveway and a fence line are legible; an individual bed
  is not. The web client requests tiles only up to the zoom that matches that resolution and states
  any further enlargement on screen — see architecture/map-rendering-and-editing.md, section 3.2.
  It is a backdrop and an input to the explicitly requested, review-only aerial tracing capability.
  No provider pixel is stored as garden geometry: only proposals accepted through ordinary map
  commands become objects, with `imageExtraction` provenance and confidence.

Both end at the United States border, which is ADR-0007's first market. Each surface says so rather
than presenting absent coverage as a failure.

Rejected, and why, so the reasoning is not re-derived: Google, Mapbox and HERE each restrict storing
or deriving from results, and tracing a lot outline from imagery is deriving from it; Nominatim's
data is ODbL share-alike, the same defect that disqualified OpenWeather for weather.

## 6. Basemap and Imagery

The map adapter supplies context only. It records:

- Tile or imagery source.
- Geographic coverage.
- Imagery date when available.
- Attribution text and URL.
- Permitted cache duration.
- Processing and derivative restrictions.

MapLibre is the web rendering engine, but the commercial tile provider is selected during implementation after coverage, cost, and licensing review. MapKit may provide native context without changing canonical geometry.

## 7. Geocoding

Geocoding output is a suggestion and contains provider, formatted address, geographic point, precision class, and attribution requirements.

Users can correct location. Provider address text does not become an immutable identity or legal boundary.

## 8. Plant Content

Separate:

- Stable application taxonomy identifiers.
- Provider taxonomy identifiers.
- User garden facts.
- Licensed descriptions and images.

Provider content stores source, version/fetch time, attribution, jurisdiction, and allowed presentation behavior. User edits do not overwrite provider source records.

## 9. AI Providers

Vertex AI is the initial provider behind the AI adapter. The adapter enforces use-case schema, model configuration, privacy filtering, timeout, cost budget, and structured-result validation.

A provider replacement must reproduce evaluation quality and deletion/privacy obligations before rollout.

Five AI capabilities are wired today. Aerial site tracing intentionally shares the plat-reader
switch and model because both are map-capture review flows; the other capabilities retain their own
switches. All use one shared Vertex project/location (ADR-0008):
model, and one shared Vertex project/location (ADR-0008):

| Capability                   | Switch                                  | Model variable             | Adapter                                             |
| ---------------------------- | --------------------------------------- | -------------------------- | --------------------------------------------------- |
| Recommendation explanations  | `RECOMMENDATION_AI_EXPLANATION_ENABLED` | `RECOMMENDATION_AI_MODEL`  | `vertex-ai-explanation-adapter.ts`                  |
| Plant species identification | `PLANT_SPECIES_AI_ENABLED`              | `PLANT_SPECIES_AI_MODEL`   | `vertex-ai-plant-species-identification-adapter.ts` |
| Plant condition analysis     | `PLANT_CONDITION_AI_ENABLED`            | `PLANT_CONDITION_AI_MODEL` | `vertex-ai-plant-condition-analysis-adapter.ts`     |
| Plat reading (ADR-0018)      | `PLAT_READING_ENABLED`                  | `PLAT_READING_MODEL`       | `vertex-ai-plat-extraction-adapter.ts`              |
| Aerial site tracing          | `PLAT_READING_ENABLED`                  | `PLAT_READING_MODEL`       | `vertex-ai-aerial-tracing-adapter.ts`               |

Plat reading differs from the other three in what it asks for: a TRANSCRIPTION. Every field it
returns is text printed on the page — a bearing in degrees, minutes and seconds; a distance with
the label it was read from; the address as written — plus page-coordinate outlines for the shapes
drawn on the sheet. It is told in the instruction, and again by the response schema's own shape,
that it may not compute the lot polygon, may not convert a unit, and may not state a dimension in
feet or metres for anything but the boundary calls. The polygon is walked from the calls by
`gardens-mapping/domain/survey-traverse.ts`; the scale for everything else comes from fitting the
lot's page outline onto that walked polygon (`page-to-ground.ts`). Its timeout and token ceiling
are far larger than the other capabilities' (`PLAT_READING_CALL_TIMEOUT_MS`, default 120 s;
`PLAT_READING_MAX_OUTPUT_TOKENS`, default 8192) because a plat carries dozens of calls and every
structure on the lot, and the call is interactive — a person is waiting on it.

The page-coordinate shapes come from a distinct whole-parcel visual pass within that reading. It
checks explicitly for structures, driveways and walks, patios, fences, easements, and trees, and
returns clear unlabelled linework with an empty label instead of dropping it. Printed measurements
remain strict transcription; visual classification is confined to these reviewable shapes and
always carries model confidence.

A curved frontage has one printed chord call but may have several visual page points along its arc.
The adapter therefore does not require boundary-call count to equal page-outline point count;
survey completeness is decided by the minimum-call safeguard and the independently computed
traverse closure. An unread bearing may be encoded by the constrained model as an omitted property
or JSON `null`; both normalize to the same explicit missing-bearing value.

Aerial tracing requires one already-aligned, saved survey lot. There is no county-specific adapter,
parcel aggregator, provider cascade or image-inferred lot. The API fetches a 1024 px, north-up USGS
export covering 160 m around the saved lot center and asks Vertex only for normalized
outlines/lines/points inside that supplied boundary. The
structured result distinguishes visible from inferred evidence and includes roof footprints,
driveway/walk centerlines, parking surfaces, fences, water/utility areas and mature trees. The API
converts those points into the existing garden-local coordinate space and returns them without
writing. A person selects what becomes ordinary map objects.

### 9.1 Which photograph is sent without imposing a product identification limit

A vision transport can refuse a large encoded object even though the product accepts and preserves
that original. Modern phone originals routinely cross that internal transport boundary. The
application therefore treats rendition preparation as part of identification, not as a limit the
person has to understand or work around:

- **The analysis source is the largest stored object that fits.** `pickAnalysisSource`
  (`services/api/src/modules/media/domain/analysis-source.ts`) chooses a display derivative
  when the derivative job has produced one and the original otherwise. Detail is what a
  species guess depends on, so among the objects that fit, the biggest wins.
- **A command never sends an object the transport cannot accept.** If no suitable rendition exists
  yet, the API returns a typed, retryable preparation state. The web mutation retries without a
  fixed attempt cap and completes when derivative generation publishes the rendition.
- **Candidate creation is fail-closed.** A provider failure or absence of a confident match never
  creates an `Unidentified candidate`. Existing candidates with photos expose an explicit
  `Identify from photo` command so a failed historical attempt can be run again.

`VISION_ANALYSIS_SOURCE_MAX_BYTES` (`packages/api-contracts`) is an internal adapter transport
capability used only to choose a stored analysis source. It is not a user-facing upload or
identification limit and the web client does not compare a person's original against it.

## 10. Transactional Messaging

Firebase Cloud Messaging is the push provider. A transactional email provider is selected before professional client sharing because email-bound client invitations and publication notices require it. The provider follows the same adapter principles.

The application owns notification intent and preference logic; the provider owns only delivery transport.

### 10.1 Selected Provider

**Resend** (free tier, 3,000 messages/month, no monthly subscription) is the selected transactional email provider, decided July 26, 2026 — implementation-plan.md section 29.1.1. **Postmark** ($15/month, better-established deliverability) and **Amazon SES** (near-zero pay-per-use cost, but bounce/complaint delivery via Amazon SNS rather than a plain webhook) are the named fallback providers and are not implemented; adding either is one adapter class plus one registration, the identical "one adapter class plus one registration" shape section 5.1 already establishes for the weather decision.

The decision was made on the owner's explicit no-monthly-cost constraint at launch, not on deliverability: Postmark scores better on independent inbox-placement benchmarks, and that trade-off is recorded as accepted, not overlooked. Resend uses the same plain-webhook integration shape Postmark does, so switching later does not require a redesign.

**Verified live, July 26, 2026** (`https://resend.com/docs/api-reference/emails/send-email`; `https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests`), not assumed from memory:

- Sending is a plain `POST https://api.resend.com/emails`, authenticated with a bearer API key, JSON body (`from`, `to`, `subject`, `html`, `text`); success returns `200` with `{ "id": "<uuid>" }`. No SDK is required — the adapter calls `fetch` directly, the same "plain HTTPS/JSON, no new dependency" posture the Open-Meteo adapter already established.
- Bounce/complaint/delivery webhooks are signed using Svix's convention (`svix-id`/`svix-timestamp`/`svix-signature` headers; HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`), also implementable with `node:crypto` alone.

**What P9C-INVITE-01 built, and what it deliberately did not.** The send path (`ResendTransactionalEmailAdapter`, `services/api/src/modules/integrations/persistence/`) is real and used by `CreateClientInvitation` to deliver the one email this package's own scope requires. Webhook signature verification was verified against the live docs above but has no receiving endpoint yet: no schema exists to record a delivery-status/bounce/complaint fact against an invitation, and building one is a genuinely separate capability (suppression handling, delivery-status telemetry), not a detail of sending. This is a clearly-flagged follow-up, not a silently skipped requirement — a later package that needs delivery-status visibility adds a receiver route plus the small schema it needs, on top of the signature-verification approach already confirmed here.

## 11. Reliability

- Interactive provider calls use strict deadlines.
- Long or retryable work moves to Cloud Tasks.
- Retry honors provider guidance and uses jitter.
- Circuit breaking prevents cascading failure.
- Cached stale data is labeled and used only when product rules permit it.
- Provider outage does not roll back already committed domain transactions.

## 12. Webhooks

Inbound webhooks require:

- Signature and timestamp verification.
- Replay protection.
- Bounded body size.
- Idempotent event ID.
- Schema version handling.
- Immediate durable acceptance before long processing.
- No trust in webhook source IP alone.

## 13. Security and Privacy

- Credentials live in Secret Manager.
- Workload identities receive only required secret access.
- User data is minimized before transfer.
- Provider terms are reviewed for training and retention.
- Precise addresses and media are not sent unless necessary for the approved capability.
- Provider requests and responses are not logged in full.

## 14. Cost and Quota

Adapters emit request count, unit usage, cache outcome, estimated cost, and quota state. Application-level quotas protect expensive integrations from abuse or accidental loops.

## 15. Testing

- Contract fixtures for normalized mapping.
- Timeout, rate limit, and malformed response.
- Provider schema drift.
- License attribution rendering.
- Cache freshness and stale fallback.
- Webhook replay and signature failure.
- Secret absence and IAM denial.
- Provider replacement compatibility.

## 16. Completion Criteria

- No domain module imports a provider SDK.
- Provider content retains source and license metadata.
- Every adapter has bounded failure and quota behavior.
- Replacing a provider does not require migrating accepted garden meaning.
- Sensitive transfers are documented and minimized.
