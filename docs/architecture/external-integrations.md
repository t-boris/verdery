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
- Confidence or provider quality where supplied.
- License and redistribution constraints.

Recommendations check freshness and degrade when data is stale.

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

**Known gap in the record model.** The terms require a _link_ beside displayed data, but `weather_record` models attribution as one free-text field (`attribution_text`) with no structured attribution URL — unlike section 6's basemap requirements, which name "attribution text and URL" separately. The link therefore travels inside the attribution text. A structured `attribution_url` would need a domain change and a migration; until then, clients must render the attribution text verbatim, link included.

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

## 10. Transactional Messaging

Firebase Cloud Messaging is the push provider. A transactional email provider is selected before professional client sharing because email-bound client invitations and publication notices require it. The provider follows the same adapter principles.

The application owns notification intent and preference logic; the provider owns only delivery transport.

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
