# Data Export and Deletion Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines user data ownership, portable export, export package structure, asynchronous generation, secure delivery, account and garden deletion, recovery windows, provider cleanup, and verification.

## 2. Principles

- Users can obtain a useful machine-readable copy of their garden data.
- Export preserves provenance, units, uncertainty, and non-survey limitations.
- Export does not expose another collaborator's private account data beyond shared-garden policy.
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
- Garden and account deletion reach database, storage, jobs, caches, identity, and providers in scope.
- Offline clients receive revocation and deletion state.
- Deletion completion is verifiable without retaining deleted content.
