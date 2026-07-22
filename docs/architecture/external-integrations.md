# External Integrations Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

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

Firebase Cloud Messaging is the push provider. A transactional email provider is selected during implementation through the same adapter principles.

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
