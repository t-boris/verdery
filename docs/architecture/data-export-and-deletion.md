# Data Export and Deletion Design

> Status: Draft 0.3
> Decision status: Approved baseline  
> Last updated: July 28, 2026

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
- Raw AR capture artifacts require separate sensitive-media permission and retention availability.
- Any future raw reconstruction artifacts require an explicit export policy before collection; no
  committed feature currently produces them.
- Support personnel cannot generate user exports without an audited approved process.
- A client engagement export includes only data entitled by its recorded stewardship policy.
- The default residential-service policy includes the accepted garden model, client publications, published completed-work snapshots derived from work logs, and entitled published media; it does not expose raw internal work logs.
- Service organizations retain their internal operational records unless garden/account deletion or another policy applies.

### 4.1 Implemented client engagement export profile (P9C-EXPORT-01)

`GET /client/gardens/{clientGardenId}/exports` (`openapi.yaml`, tag `ClientPortal`, operation
`getClientExportManifest`) is the client-scoped equivalent of the account/garden export above,
built as a genuine extension of the `exports` module (`GetClientExportManifest`) rather than a
second export system. It is **synchronous** — one manifest, no request/poll/download job — because
a client export is categorically bounded: the CURRENT accepted garden model (no history), a
handful of currently published summaries, and media served as short-lived signed URLs, the same
one-item-at-a-time mechanism `getClientMediaAccess` already uses. What P8-EXPORT-01's discipline it
reuses is the manifest itself: it discloses exactly what is included, and anything that fails
entitlement is silently absent, never a distinguishable error — not the ZIP/staging/Cloud-Tasks
machinery, which nothing here produces enough bytes to need.

**Authorization** goes through `ClientPortalAuthorization`, extended with one new method,
`requireExportableGardenAccess`, rather than a second authorization class. It admits an engagement
that is `active` OR `ended` — the one deliberate widening beyond every other client-portal read, so
that ending an engagement does not itself delete the client's own ability to obtain the handoff
package section 18 promises. `revoked` and `draft` are refused exactly like every other
`ClientPortal` route: section 8's blanket "an ended or revoked engagement cannot authorize new
portal or media access" still governs a revocation, which section 18's handoff promise was never
meant to override.

**The manifest** has three parts:

- `gardenModel` — the accepted garden model: current map objects (`lifecycle_state = 'active'`,
  excluding soft-deleted history) and current plants, read through the SAME repositories and view
  functions (`toGardenObjectResource`/`toPlantResource`/`toGeoreferenceResource`) the operational
  `getGardenMap`/`searchPlants` reads already use — never a second copy of that mapping logic.
  Garden memberships and calibrations are deliberately excluded: neither is "the accepted garden
  model," and calibrations are capture-processing diagnostics.
- `publications` — every CURRENTLY published (never withdrawn) update, via
  `ClientPublicationReadRepository.listVisibleForEngagement` plus `toClientPublicationSummaryResource`,
  the exact query and shaping `listClientPublications` already uses. **Decided:** "published
  deliverables" means currently published, not ever published — an export that included withdrawn
  content anyway would be a side channel around the client's own portal.
- `media` — every media item this client is genuinely entitled to, re-verified ONE AT A TIME
  through the SAME `GetClientMediaAccess` command the live media-access route calls (never a
  re-derived entitlement rule). An item that fails entitlement is silently absent, proven the same
  way the media-access denial matrix proves it.

**The genuine gap, flagged rather than invented around:** section 18 step 3 promises portal/media
access survives "the configured handoff window" after an engagement ends. No such window is
configured anywhere in this codebase yet — `GetClientMediaAccess` requires the entitling engagement
to be `active`, full stop, so an ended engagement's media becomes unavailable the INSTANT it ends,
not after a grace period. This command does not invent a number to close that gap; it makes the
export's own `media` list behave consistently with the live media-access route (both go empty at
the same instant, for the same reason) and records the gap here.

**Deletion consistency.** `client_engagement.garden_id` deliberately carries no foreign key (see
section 13.1's purge-survivor table and the P9B-DATA-01 migration's own note), so the engagement
record survives a garden purge for audit/dispute/legal retention — but that preservation is for the
PROVIDER, not for continued client service. Once the underlying garden row is gone, or the garden
has reached `purging` (the same point past which the operational `exportGarden` capability is
refused, for the identical "a request accepted now would point at a row the purge is about to
delete" reason), the manifest command refuses the same concealed way an unknown `clientGardenId`
does. `deletionRequested` stays exportable, mirroring the operational export's own posture exactly.

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

### 10.1 Implemented garden-deletion profile (P8-DELETE-01)

`RequestGardenDeletion` (gardens-mapping) opens the window; the deletion sweep closes it. Step by
step against the list above:

1. **Owner capability and recent authentication.** The `manageGarden` capability, plus a **30-minute**
   step-up gate evaluated against the session's own `auth_time` — the same figure and the same
   never-trust-a-client-claim posture P8-EXPORT-01 set for account-wide export, stated once in
   `shared/deletion/deletion-policy.ts` so garden and account deletion cannot drift apart. The gate
   applies to the RESTORE direction too: an attacker who can silently withdraw a victim's
   protective deletion has defeated the same protection from the other side. It also applies on the
   offline path — `requestGardenDeletion` pushed through `POST /sync/push` is gated on the pushing
   session's `auth_time` and rejected per-operation otherwise, because exempting sync would leave
   the whole gate bypassable by wrapping the command in a batch.
2. **Resolves other owners and shared access** and **6. emits revocation changes** happen together,
   at REQUEST time: every non-owner membership moves to `removed` and each revoked member receives
   the garden as an ordinary `garden`/`delete` change on their next pull, so their offline client
   purges its local copy (section 13). The requesting OWNER keeps their membership — they are the
   only person who can withdraw the request, and a recovery window that locks out the person who
   might change their mind is not a recovery window.
3. **Marks deletion requested and revokes new edits** — the lifecycle transition, plus the single
   enforcement point that makes "revokes new edits" true: `GardenAuthorization.requireCapability`
   refuses the `editGardenContent` capability while a garden is `deletion_requested` or `purging`.
   Every garden-scoped content command in every module (map objects, calibration, plants,
   observations, tasks, media) authorizes through that one method, so the freeze covers commands
   added later without each one repeating a check. Which capability survives which lifecycle state
   is a matrix in `gardens-mapping/domain/garden-role.ts`, exhaustive over capabilities by type, so
   a new capability cannot compile without a decision. The refusal is `garden.lifecycle_conflict`
   (HTTP **422**), the same code the domain's own lifecycle refusals raise, and on the offline path
   it becomes a per-operation `rejected` push outcome — terminal, so a queued edit into a garden
   marked for deletion since it was written is dropped rather than retried forever.

   Three deliberate exemptions, each load-bearing:
   - **Reads are never refused** (`viewGarden` in every state). A window in which the owner cannot
     see what they are about to lose is not a recovery window.
   - **Garden export stays available while `deletion_requested`** (`exportGarden`), for the same
     reason — but is refused once the garden is `purging`, because step 5's
     `exports.export_request.close_active` has already run by then and a request accepted afterwards
     would point at a garden row the purge is about to delete.
   - **`manageGarden` is not gated by lifecycle state at all**, because RESTORE holds it: the four
     lifecycle commands disagree about what is legal from where, and only their domain transitions
     can express that (`renameGarden` and `archiveGarden` refuse a pending deletion through the
     domain's own `requireMutable`; `restoreGarden` accepts `deletion_requested` and refuses
     `purging`).

   The purge itself is unaffected: it writes through its own executor and unit of work, never
   through `GardenAuthorization`, so the guard can never block the work it is waiting for.

4. **The approved recovery window** — `recovery_deadline_at`, stamped 30 days out (section 11 names
   the figure once, for the whole feature). `DELETE /gardens/{gardenId}/delete-request` reverses
   everything above until the sweep claims the garden.
5. **Cancels or closes pending jobs** happens at PURGE time, not request time, and deliberately:
   cancelling a media job is irreversible while the request is reversible for thirty days, so a
   restored garden must not come back with half-processed media. At purge, media processing jobs
   are cancelled by the deletion workflow itself (one media record at a time) and an in-flight
   export request is transitioned to `failed` with `subject_purged` before its rows go, so a worker
   still holding it cannot complete and register a package for a garden that no longer exists.
6. **Purges domain records, media, derivatives, and exports** — see section 13.1.
7. **Verifies provider cleanup** — the purge does not delete a single `media_record` row until every
   one of the garden's media records is `deleted`, which the P6-RET-01 workflow only reaches after
   the worker re-lists each object prefix and finds it empty. Bytes confirmed absent, then rows.
8. **Records non-sensitive completion evidence** — see section 13.1's evidence paragraph.

A REQUIRED SCHEMA CONCESSION, recorded because it looks like a weakening and is not:
`collaboration.membership` lost its foreign key to `gardens_mapping.garden`. A revoked membership
row IS the offline-synchronization revocation tombstone (`GetSyncChanges` decides what a client may
still learn from exactly that table), so it must outlive the garden it names — otherwise the one
change that matters most becomes undeliverable the instant the purge removes the garden row. This
is the reasoning `platform.sync_change` already documents for having no foreign keys at all,
applied to the second table the same protocol reads.

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

### 11.1 Implemented account-deletion profile (P8-DELETE-01)

`POST /account/deletion` (tag `Account`) requires the same 30-minute step-up gate as garden
deletion and moves the account to `deletion_requested`, which by itself is what "ordinary access is
disabled" means: `isAccountUsable` already gates every authenticated route on `active`. The three
account-deletion routes are the ONLY ones registered in an encapsulation context that admits
`deletion_requested`, because a window the user cannot act inside is not a recovery window — the
authentication plugin's own header anticipated exactly this opt-out.

**Ownership resolution** runs synchronously inside the request transaction and is reported back on
the resource, so the user sees what happens to each garden before the deadline rather than
afterwards:

| Situation                    | Resolution                   | Effect                                                                      |
| ---------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Sole active owner            | `gardenDeletionRequested`    | The garden enters its own deletion on the SAME deadline and purges with it. |
| Another active owner remains | `ownershipRetainedByCoOwner` | The garden survives; only this membership is revoked.                       |
| Editor or viewer             | `membershipRevoked`          | The garden is untouched.                                                    |

The co-owner branch IS section 11's "transfer" branch, resolved by the co-owner already holding
ownership rather than by inventing a transfer flow: naming a recipient requires an invitation
mechanism that does not exist yet (recorded in `deferred-capabilities.md`). Every revocation writes
the leaver an addressed `garden`/`delete` change, so their other devices converge too.
`DELETE /account/deletion` reverses the account state, every membership the request revoked, and
every garden it put into deletion.

After the deadline the sweep claims the account into `disabled` — the state
`identity-and-authorization.md` section 7's `deletion_requested → disabled → purged` already
names — and the purge runs in a strictly ordered sequence: personal rows, then the identity
provider, then the tombstone. **That order is the failure-safety argument.** The provider call
needs the real `firebase_uid`, which the tombstone destroys; and if the provider refuses, the
account stays `disabled` (unusable, still purgeable) rather than `purged` with a signable
credential outstanding.

**The profile ROW survives, minimized.** It has to: roughly twenty NOT NULL foreign keys point at
it from content inside SHARED gardens that outlive the account
(`plant.created_by_profile_id`, `garden_object_revision.actor_profile_id`,
`media_record.uploaded_by_profile_id`, …), and that content belongs to those gardens, not to the
person. Deleting the row is therefore impossible without destroying other people's gardens. What is
possible, and what the purge does, is to leave nothing but an opaque identifier: `firebase_uid`
becomes an unresolvable `purged:<profileId>` (the column is NOT NULL and UNIQUE, so it is replaced
rather than nulled, and the value can never collide with a real Firebase uid or be used to look the
person up), locale and time zone return to defaults, and `account_state` is `purged`. A later
sign-in by the same human lands on a brand-new profile.

## 12. Immediate Deletion

Immediate irreversible deletion may be offered when shared ownership, fraud/security review, and legal obligations permit it. The UI must explain that recovery becomes impossible.

## 13. Offline Clients

Deletion and authorization revocation are represented in synchronization changes. On reconnect, clients:

- Stop pushing operations to deleted resources.
- Remove protected local read models.
- Preserve only policy-approved recovery diagnostics.
- Delete local media owned exclusively by the deleted resource.

A device that never reconnects remains subject to operating-system local data protection and documented sign-out controls.

### 13.1 Implemented purge and offline-convergence profile (P8-DELETE-01)

**The purge is an ordered data plan, not a procedure** (`modules/deletion/application/purge-plan.ts`):
a list of `{ table, predicate }` steps, leaves first. That shape buys three properties a
hand-written procedure could only claim — every step batches identically, every step is trivially
idempotent (re-running a completed one deletes zero rows, which is what makes a crashed purge safe
to retry from anywhere), and each step's name is both its checkpoint key and its evidence row.
Deletes are batched by `ctid` inside each step, and each step is its own transaction, so the
longest lock a purge holds is one step of one subject. Consecutive steps may share a `group` and
commit together — needed exactly once, where `recommendation_candidate`, `recommendation_evidence`,
and `task` form a genuine reference cycle the schema resolves with a `DEFERRABLE` constraint.

**The purge waits for bytes.** Phase 1 hands every media record to the P6-RET-01 deletion workflow;
phase 2 is a gate that defers the whole purge until every one of those records is `deleted`.
Deleting the rows first would leave orphaned objects in a bucket with nothing in the database
pointing at them — undeletable and unauditable. Waiting costs a sweep interval; not waiting costs
unrecoverable residue.

**Completeness is proved against the catalog, not asserted.** The end-to-end suite derives every
garden-referencing table from `pg_constraint` (the transitive closure of foreign keys to
`gardens_mapping.garden`) UNION every table carrying a garden-id column without one — because
`notification_intent.garden_id` deliberately has no foreign key and a future table could make the
same choice — and requires each to be a plan step or a documented exception. A migration that adds
a garden-scoped table and forgets the plan fails that test. The account half derives its own list
the same way from foreign keys to `identity_access.profile`.

**What survives a purge, and why:**

| Survivor                                                                                                                                     | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.sync_change`                                                                                                                       | The garden's `delete` tombstone. Purging it would delete the row an offline client reconnects to find.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `collaboration.membership`                                                                                                                   | Reduced to `removed` tombstones — how `GetSyncChanges` decides what a revoked client may still learn.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `platform.audit_event`                                                                                                                       | The completion trail (`garden.purge_started`, `garden.purged`, `account.purged`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `deletion.deletion_record` (+ `purge_checkpoint`)                                                                                            | The purge job, which is also the completion evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `identity_access.profile`                                                                                                                    | Account purge only, minimized to a tombstone — see section 11.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `collaboration.ownership_transfer`                                                                                                           | Account purge only — the provenance of a surviving garden's current ownership. Its profile ids now resolve to tombstones, so the record identifies nobody. The garden purge deletes it outright.                                                                                                                                                                                                                                                                                                                                                                 |
| `collaboration.work_log`, `client_update`, `publication_version`, `publication_item`, `client_update_item`, `publication_observation_detail` | Retained for audit/dispute/legal/stewardship-retention (section 18 of collaboration-and-client-sharing.md) — a professional's logged work and the publications a client actually saw survive a garden purge. `client_update_item`/`publication_observation_detail` are children of this retained chain; their one FK that DOES resolve to a purged table (`source_observation_id` → `observations_history.observation`) is `ON DELETE SET NULL`, so the purge still completes and the retained snapshot text is untouched — only the provenance link goes stale. |

**The evidence contains identifiers, timestamps, and COUNTS. Nothing else** — no name, no filename,
no location, no row copied out before deletion, and never a database error message (a stuck purge
records the fixed marker `purge_failed`, because an error text can quote a value from the row being
deleted). Section 19's "verifiable without retaining deleted content" is a schema fact here, and the
end-to-end suite asserts it directly by searching the evidence for the deleted garden's name, the
deleted account's Firebase uid, and a deleted device token.

**Offline convergence needed one addition to the P5 protocol**: `platform.sync_change
.target_profile_id`. A revocation tombstone must reach the revoked collaborator, but the SAME row
read by the still-active owner would make the owner's client discard a garden they can still
recover — the two readers cannot both be served by one unaddressed row. `NULL` keeps the original
meaning ("everyone the visibility rule admits"), so every ordinary record change is unaffected.

**Where it runs.** The sweep is the fifth to ride the established worker-tick → OIDC-endpoint
machinery (`POST /v1/internal/deletion/sweep`, hourly). `verdery_worker` gains nothing: running the
purge there would mean granting it DELETE on every module's tables, the single widest privilege
grant this codebase could make, to save one HTTP hop. Claiming a subject is a TRANSITION, not a
timestamp comparison — the subject moves to `purging`/`disabled` in the same transaction that
inserts its deletion record, after which restore is refused, so a user racing the sweep loses or
wins by whichever transaction commits first rather than by two processes reading a clock.

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
