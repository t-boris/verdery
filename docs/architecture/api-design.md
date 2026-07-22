# REST API and Contract Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the external API conventions shared by the native Apple and web applications. The API is HTTPS REST described by OpenAPI.

## 2. API Boundary

The API exposes application use cases and stable resources. It does not expose database tables, Kysely models, provider payloads, Firebase internals, or Cloud Storage object paths.

The initial base path is:

```text
/v1
```

Breaking contract changes require a new major path or a documented compatibility migration.

## 3. Contract Ownership

OpenAPI is the machine-readable source of truth for:

- Paths and operations.
- Authentication requirements.
- Request and response schemas.
- Stable error envelopes.
- Pagination.
- Idempotency and concurrency headers.
- Upload-session operations.

Generated clients are wrapped by handwritten application gateways. Generated files are never manually edited.

## 4. Resource Naming

- Paths use plural lowercase nouns and hyphens where needed.
- JSON fields use `camelCase`.
- Identifiers are opaque UUIDv7 strings.
- URLs do not expose database schema names.
- Nested paths express ownership only when it is stable and useful.

Examples:

```text
GET  /v1/gardens
POST /v1/gardens
GET  /v1/gardens/{gardenId}
GET  /v1/gardens/{gardenId}/map
POST /v1/gardens/{gardenId}/map-commands
POST /v1/media-uploads
GET  /v1/processing-jobs/{jobId}
```

## 5. Command Endpoints

Business transitions use explicit command semantics instead of generic partial row updates when invariants matter.

Examples:

- Complete task.
- Postpone task.
- Accept capture proposal.
- Recalibrate imported plan.
- Invite collaborator.
- Request account deletion.

Simple resource creation and replacement may still use POST, PUT, or PATCH when the behavior is unambiguous.

## 6. Idempotency

Retryable mutation endpoints require:

```text
Idempotency-Key: <UUIDv7>
```

The same key and semantically identical request return the same accepted result. The same key with a different command is rejected with a stable conflict code.

## 7. Optimistic Concurrency

Revision-sensitive operations carry an expected revision in one approved form:

```text
If-Match: "<revision>"
```

or an explicitly documented `expectedRevision` command field when batching requires it.

Stale writes return `409 Conflict` or `412 Precondition Failed` consistently, with current revision and a stable recovery code when disclosure is authorized.

## 8. Authentication

The API supports approved Firebase credentials:

- Native Firebase ID tokens.
- Verified web session credentials or an approved short-lived exchange path.

App Check is a separate defense-in-depth credential. Authentication and App Check do not replace garden authorization.

## 9. Actor Context

After verification, the backend creates an actor context containing:

- Application user ID.
- Firebase identity reference.
- Authentication time and provider where needed.
- Request and trace IDs.
- Device or client class from trusted signals.
- App Check status.
- Administrative support context when explicitly activated.

Clients cannot submit authoritative role or garden-membership claims.

## 10. Request Format

- JSON is the default structured representation.
- UTF-8 is required.
- Canonical timestamps use RFC 3339 UTC.
- Canonical measurements use SI units with explicit unit metadata where ambiguity exists.
- GeoJSON includes coordinate-space metadata outside the standard geometry object.
- Large binary media does not pass through JSON or the API container.

## 11. Response Format

Successful single-resource responses return the resource representation or a documented command result. Avoid unnecessary generic wrappers.

Asynchronous acceptance returns `202 Accepted` with:

```json
{
  "jobId": "019...",
  "status": "queued",
  "statusUrl": "/v1/processing-jobs/019..."
}
```

Creation returns `201 Created` and a stable resource location where applicable.

## 12. Error Envelope

All expected errors use:

```json
{
  "error": {
    "code": "garden.geometry.stale_revision",
    "message": "The garden object changed before this edit was saved.",
    "correlationId": "...",
    "details": [],
    "retryable": false
  }
}
```

`message` is safe fallback text. Clients localize ordinary known errors by `code` and structured details.

Validation details identify JSON path or domain object without leaking unauthorized records.

## 13. Status Codes

| Code | Use                                                                 |
| ---- | ------------------------------------------------------------------- |
| 200  | Successful query or command with response body                      |
| 201  | Resource created                                                    |
| 202  | Asynchronous work accepted                                          |
| 204  | Successful command without response body                            |
| 400  | Malformed or invalid request                                        |
| 401  | Missing or invalid authentication                                   |
| 403  | Authenticated but not authorized                                    |
| 404  | Not found or intentionally concealed existence                      |
| 409  | Domain or synchronization conflict                                  |
| 412  | Failed explicit revision precondition                               |
| 413  | Request or declared upload too large                                |
| 422  | Structurally valid request that violates a domain rule where useful |
| 429  | Quota or rate limit exceeded                                        |
| 500  | Unexpected internal failure                                         |
| 503  | Temporary required dependency unavailable                           |

## 14. Pagination

Use opaque cursor pagination for changing collections. Responses contain items and an optional next cursor. Clients must not parse cursors.

Offset pagination is limited to stable administrative reports where consistency requirements are documented.

Every list endpoint has a bounded default and maximum page size.

## 15. Filtering and Sorting

Filters are explicit documented query parameters. Arbitrary SQL-like filtering is prohibited.

Sort fields are allowlisted and include a stable tie-breaker. Spatial queries expose purpose-specific parameters such as viewport bounds rather than accepting arbitrary PostGIS expressions.

## 16. Synchronization Endpoints

The native sync API is distinct from ordinary screen queries:

```text
POST /v1/sync/push
GET  /v1/sync/changes?after=<cursor>&limit=<n>
POST /v1/sync/acknowledge
```

Push requests contain ordered client operations with IDs, base revisions, and payload versions. Each operation receives an individual accepted, duplicate, rejected, or conflict result.

Change responses are deterministic, ordered, bounded, and resumable.

## 17. Media API

The media API controls metadata and authorization:

1. Create upload record.
2. Receive resumable upload session or approved transfer authorization.
3. Upload directly to Cloud Storage.
4. Request or receive completion verification.
5. Query processing state.

Signed or session URLs are short lived and never become permanent media identifiers.

## 18. Geometry Contracts

Geometry payloads contain:

- GeoJSON geometry.
- `coordinateSpaceId`.
- Object category.
- Revision.
- Provenance.
- Confidence or uncertainty.
- Measurement metadata where relevant.

API documentation explicitly states whether coordinates are local meters or geographic longitude/latitude. Standard GeoJSON alone is insufficient for local-space interpretation.

## 19. Caching

- Private authenticated responses default to no shared caching.
- Stable public reference content may use ETag and cache controls.
- Resource queries may use ETag for conditional retrieval.
- Command responses are not cached by intermediaries.
- Signed media access obeys storage and privacy policy.

## 20. Rate Limits and Quotas

Limits are classified by operation cost:

- Ordinary reads.
- Ordinary mutations.
- Authentication-sensitive operations.
- Media session creation.
- Garden Scan and AI processing.
- Export and deletion.

Quota responses include a stable code and retry guidance without disclosing system-wide capacity.

## 21. Deprecation

- Additive fields are preferred.
- Clients ignore unknown response fields.
- Required request fields are introduced only through compatible workflow or major-version change.
- Deprecated fields and operations have telemetry and a published removal condition.
- Mobile release lag is included in removal decisions.

## 22. Security

- Request and response sizes are bounded.
- OpenAPI validation occurs before application execution.
- Authorization is resource-specific.
- CORS allowlists exact production origins.
- Cookie-authenticated mutations use CSRF protection.
- Error responses avoid existence and tenant leakage.
- Sensitive values are redacted from structured logs.

## 23. Testing and Governance

- OpenAPI linting runs in CI.
- Generated Swift and TypeScript clients must compile.
- Backward-compatibility checks run against the previous released contract.
- Examples are executable fixtures where practical.
- Route integration tests validate status, error, auth, idempotency, and concurrency behavior.
- Documentation changes are required in the same change as API behavior.

## 24. Completion Criteria

- Native and web clients consume the same authoritative contract.
- Every mutation has defined idempotency and concurrency behavior.
- Sync batches are resumable and partially reportable without ambiguity.
- Large media bypasses the interactive service.
- Geometry cannot be misinterpreted as WGS84 accidentally.
- API implementation details do not leak database or provider models.
