# Data Export and Deletion Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines user data ownership, portable export, export package structure, asynchronous generation, secure delivery, account and garden deletion, recovery windows, provider cleanup, and verification.

## 2. Principles

- Users can obtain a useful machine-readable copy of their garden data.
- Export preserves provenance, units, uncertainty, and non-survey limitations.
- Export does not expose another collaborator's private account data beyond shared-garden policy.
- Client export does not expose provider-internal notes, assignments, drafts, estimates, diagnostics, or unpublished work.
- Export and deletion are authenticated, authorized, auditable, asynchronous, and idempotent.
- Deletion reaches authoritative, derived, cached, and provider-controlled data in scope.

## 3. Export Scope

The baseline export is a ZIP package containing, as applicable:

- JSON garden manifest and records.
- GeoJSON map objects with explicit coordinate-space metadata.
- CSV tables for plants, observations, tasks, and recommendations where useful.
- Original user media the requester is entitled to export.
- Media metadata and checksums.
- Human-readable README describing structure, units, uncertainty, and limitations.
- Export schema and application version.

PDF reports and GeoPackage are future optional formats. Shapefile is not a baseline because of format and field limitations.

## 4. Export Authorization

- Account export covers the requesting user's owned personal data and authorized garden data according to collaboration policy.
- Garden owner can export the full shared garden subject to collaborator privacy rules.
- Editor and viewer export rights are controlled by garden capability.
- Raw scan artifacts require separate sensitive-media permission and retention availability.
- Support personnel cannot generate user exports without an audited approved process.
- A client engagement export includes only data entitled by its recorded stewardship policy.
- The default residential-service policy includes the accepted garden model, client publications, published completed-work snapshots derived from work logs, and entitled published media; it does not expose raw internal work logs.
- Service organizations retain their internal operational records unless garden/account deletion or another policy applies.

## 5. Export Request

An export request records:

- Request UUIDv7.
- Requester and authenticated session context.
- Scope and garden IDs.
- Requested format version.
- Media inclusion choice.
- State and progress.
- Creation, expiration, and completion times.
- Output media ID and checksum.

Recent authentication is required for account-wide export.

### 5.1 Implemented request profile (P8-EXPORT-01)

`exports.export_request` (1786300000000_exports-baseline.sql) records every field above, plus the
pre-minted `export_package` media id and its exports-bucket object target (minted at REQUEST time
so the object key embeds the media UUID and the established prefix-scoped deletion pipeline reaches
the package bytes). Two scopes exist: `account` (the requester's personal data plus every garden
they OWN; lesser-role gardens are named in the package manifest as excluded — widening per-role
entitlement is a recorded deferred decision) and `garden` (owner-only, via the new `exportGarden`
capability). "Recent authentication" is enforced against the session's own `auth_time`:
**30 minutes** for account scope — no document names a figure, so this is a reasoned, documented
default. The rate limit is **one active export per requester**, enforced by a partial unique index
(`export_request_one_active_per_requester`), pre-checked for the friendly `409` and translated by
constraint name for the race. `POST /exports`, `GET /exports/{id}`, and
`GET /exports/{id}/download` are the contract surface (`openapi.yaml`, tag `Exports`); client UI
for requesting exports is not built yet.

## 6. Generation Flow

```text
authorized request
       │
       ▼
consistent export boundary
       │
       ▼
Cloud Run Job reads bounded pages
       │
       ├── JSON / GeoJSON / CSV
       ├── media manifest
       └── README and checksums
       │
       ▼
encrypted private ZIP in export bucket
       │
       ▼
short-lived authorized download
       │
       ▼
automatic expiration and deletion
```

Large exports checkpoint progress and do not hold one unbounded database transaction.

## 7. Consistency

Export records a server revision or snapshot boundary. Changes after that boundary may be excluded and are disclosed in the manifest.

References remain internally consistent. Missing media caused by prior deletion is listed explicitly rather than silently omitted.

### 7.1 Implemented generation and consistency profile (P8-EXPORT-01)

The generation flow rides the established asynchronous machinery, split along the privilege wall
(`verdery_worker` holds no module-table grants):

1. `RequestExport` appends `export.requested` to the transactional outbox; the workers relay
   enqueues ONE Cloud Tasks `export_generation` task (task name = event id, so redelivery
   deduplicates; no `media.processing_job` row — the export request row IS the durable job, with
   its own `requested → running → completed | failed` state machine and attempt counter).
2. The worker job calls the API's OIDC-verified internal endpoints
   (`POST /internal/exports/{id}/snapshot|checkpoints|complete`) for every database fact and moves
   every byte itself: it stages the served sections into the exports bucket under
   `staging/{exportRequestId}/`, records ALL of them in one checkpoint call, then streams staged
   sections plus entitled media originals into the final ZIP (`archiver`), adding
   `missing-media.json` and `checksums.txt` at assembly time.
3. `CompleteExport` binds, in ONE transaction: the `export_package` media record (registered
   `available`, garden-less, with the live 7-day registration-anchored retention deadline), the
   request's `completed` transition (package checksum + the same expiry instant), and the
   `export.completed` outbox event.

**The consistency boundary is one `REPEATABLE READ, READ ONLY` transaction.** Every structured
read of one snapshot attempt shares that transaction's MVCC snapshot (bounded 1000-row keyset
pages inside it), so cross-references are coherent by construction and rows created after the
boundary are absent; the boundary instant is stamped inside the transaction and disclosed in the
package's `export.json`. Checkpointing freezes it: once the staged section set is recorded, a
retried attempt never re-reads the snapshot — it resumes from the staged objects (verified
against their recorded checksums; corruption fails terminally). A retry BEFORE checkpointing
re-reads everything under a fresh snapshot — always one boundary's set, never a mix. Media BYTES
are copied outside any transaction; media deleted between boundary and assembly is listed in
`missing-media.json`, never silently omitted. Known limits, recorded in
`docs/development/deferred-capabilities.md`: assembly restarts whole on a retry (per-media-file
resume inside one assembly pass is deferred), and structured sections travel in one snapshot
response (fine at metadata scale; response streaming is deferred).

## 8. Geospatial Export

GeoJSON includes:

- Garden-local geometry.
- `coordinateSpaceId` and units.
- Optional WGS84-transformed geometry when a valid georeference exists.
- Georeference revision and accuracy.
- Object category, provenance, confidence, and accepted revision.

The README warns that boundaries and phone-derived measurements are not legal survey data.

## 9. Secure Delivery

- Export objects are private.
- Download authorization is short lived.
- Export package automatically expires after the communicated short window.
- Export URLs and contents are never logged or sent through analytics.
- The requester receives an in-app notification; email may be added through the notification adapter.
- Repeated download requires reauthorization after URL expiration.

### 9.1 Implemented delivery profile (P8-EXPORT-01)

Delivery is the established signed-access mechanism: `GET /exports/{id}/download` mints a
short-lived signed URL through the same `MediaStorageGateway` every media download uses. It is
REQUESTER-BOUND twice over: the endpoint conceals any other caller's request id as not-found, and
the package's media record is deliberately registered with `gardenId = null`, so no garden-scoped
media route can ever serve it to a fellow collaborator — structurally, not by a check that could
regress. Expiry is the existing 7-day `export_package` machinery (registration-anchored deadline +
retention sweep + the live exports-bucket lifecycle rule); the download additionally refuses past
`expiresAt` and once the package record leaves `available`. The package contains only entitled
content: no internal bucket names or object keys (the worker-only `media-transfer.json` carries
those and never enters the ZIP), no other collaborator's account data, no `raw_capture`. Export
URLs and contents are never logged (the transport logs ids and outcomes only). The completion
notification is a durable `export_ready` in-app intent through the P7 pipeline (relay-forwarded
`export.completed` event → notification policy → deduplicated, package-expiry-bounded inbox
entry; `notification_intent.garden_id` became nullable for account-wide exports); push and email
channels are deliberately not enabled for it.

## 10. Garden Deletion

Garden deletion:

1. Requires owner capability and recent authentication.
2. Resolves other owners and shared access.
3. Marks the garden deletion requested and revokes new edits.
4. Provides the approved recovery window when applicable.
5. Cancels or closes pending jobs.
6. Emits revocation changes for offline clients.
7. Purges domain records, media, derivatives, search projections, and exports.
8. Verifies provider cleanup where applicable.
9. Records non-sensitive completion evidence.

Client engagement termination is not garden deletion. It revokes portal access, closes pending client invitations, stops future delivery, and executes the engagement handoff/export policy while preserving authorized provider-internal operational records.

## 11. Account Deletion

The baseline recovery window is 30 days. During the window, ordinary access is disabled and the user may recover through a verified process where offered.

After the deadline, an idempotent workflow:

- Resolves owned shared gardens by transfer or deletion policy.
- Revokes invitations, memberships, sessions, and device channels.
- Purges personal domain data.
- Deletes or transfers media according to garden ownership.
- Removes analytics identifiers where supported and required.
- Requests deletion from relevant external providers.
- Deletes Firebase Authentication identity after application preconditions.
- Records completion.

## 12. Immediate Deletion

Immediate irreversible deletion may be offered when shared ownership, fraud/security review, and legal obligations permit it. The UI must explain that recovery becomes impossible.

## 13. Offline Clients

Deletion and authorization revocation are represented in synchronization changes. On reconnect, clients:

- Stop pushing operations to deleted resources.
- Remove protected local read models.
- Preserve only policy-approved recovery diagnostics.
- Delete local media owned exclusively by the deleted resource.

A device that never reconnects remains subject to operating-system local data protection and documented sign-out controls.

## 14. Backups

Deletion from active systems does not imply immediate physical removal from immutable operational backups. The retention schedule documents backup expiry and ensures deleted data is not restored into active use without reapplying deletion records.

## 15. Legal Hold and Fraud

Legal hold or fraud preservation requires explicit authorized policy, restricted access, audit, and user-notice analysis. It cannot be activated through ordinary support tools.

## 16. Failure and Retry

- Export and deletion steps are idempotent.
- Partial provider failure remains internally visible and retries.
- A failed export never exposes a partial public object.
- A deletion request cannot return to active accidentally after purge begins.
- Terminal manual intervention has a runbook and audited repair command.

## 17. Observability

Measure request age, generation duration, package size, download expiration, deletion stage age, provider cleanup failure, remaining object count, and completion.

Telemetry uses request IDs and counts, not exported content or URLs.

## 18. Testing

- Owner/editor/viewer export authorization.
- Shared garden collaborator privacy.
- Default and non-default client engagement stewardship policies.
- Client export excludes provider-internal operational records.
- Published work and media are included only when entitled.
- Engagement termination, client handoff, and access revocation without garden deletion.
- Consistent revision boundary during concurrent edits.
- GeoJSON local and WGS84 labeling.
- Missing/deleted media manifest.
- Large checkpointed export.
- URL expiration.
- Garden deletion with pending sync and jobs.
- Account deletion with sole-owned shared garden.
- Recovery before deadline and irreversible purge after deadline.
- Provider cleanup retry.
- Backup restore reapplying prior deletions.

## 19. Completion Criteria

- Export is machine-readable and includes geometry provenance and uncertainty.
- Download is private and expires automatically.
- Shared-garden export does not leak unrelated profile data.
- Client export does not leak provider-internal or another client's data.
- Garden and account deletion reach database, storage, jobs, caches, identity, and providers in scope.
- Offline clients receive revocation and deletion state.
- Deletion completion is verifiable without retaining deleted content.
