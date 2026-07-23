# Offline Synchronization Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines the application-owned synchronization protocol between the native GRDB/SQLite store and the authoritative PostgreSQL backend.

## 2. Goals

- Preserve acknowledged local changes during weak or unavailable connectivity.
- Provide deterministic retry and recovery.
- Apply domain-specific conflict rules.
- Avoid dual authority between PostgreSQL and Firestore.
- Keep large media transfer outside record batches while coordinating its lifecycle.
- Support future clients without exposing PostgreSQL replication directly.

## 3. Non-Goals

- Real-time simultaneous geometry collaboration in the initial release.
- Synchronizing the full operational garden into a professional client's device or browser.
- Replicating every server table to the device.
- Universal last-write-wins behavior.
- Peer-to-peer device synchronization.
- Storing large media inside synchronization payloads.

## 4. Authority Model

- PostgreSQL is authoritative for accepted synchronized data.
- SQLite is authoritative for pending local operations until the server accepts or explicitly rejects them.
- A local optimistic read model may temporarily differ from the last accepted server state.
- Conflict records preserve both the user's intent and the current server revision.
- Client publications are server-authoritative immutable projections and are not mixed into the operational mutation outbox.

## 5. Local Tables

The native store includes:

```text
local domain read models
sync_outbox
sync_cursor
sync_conflict
sync_operation_result
media_transfer
local_draft
```

The exact table names are implementation details, but their responsibilities are stable.

## 6. Local Mutation Transaction

Every offline-capable mutation executes one SQLite transaction:

1. Load the current local record and accepted server revision.
2. Validate the command locally.
3. Apply the optimistic local projection.
4. Insert an outbox operation with a client-generated UUIDv7.
5. Persist command payload version and expected revision.
6. Commit both changes atomically.

The UI displays success only as a local save until server acceptance is known.

## 7. Outbox Operation

An outbox operation contains:

- Operation ID.
- Authenticated profile ID.
- Garden ID.
- Command type and version.
- Target record IDs.
- Expected server revision.
- Canonical payload.
- Local creation order.
- Dependency operation IDs where required.
- Retry state and last error category.
- Media prerequisites where required.

Outbox payloads contain domain commands, not arbitrary row changes.

## 8. Push Protocol

The client sends bounded ordered batches:

```text
POST /v1/sync/push
```

The request identifies the client installation, profile, protocol version, and operations. Authentication and App Check are verified normally.

The server processes operations in dependency-aware order. Independent operations may succeed even when another operation conflicts. Every operation receives one result:

- `accepted`
- `duplicate`
- `conflict`
- `rejected`
- `blockedByDependency`
- `retryLater`

The response includes authoritative record revisions or references needed to update the local projection.

## 9. Server Idempotency

Operation ID is the idempotency key for synchronization commands. The server persists the stable outcome.

- A duplicate identical operation returns the prior outcome.
- Reusing an operation ID with another payload is rejected.
- An unknown client response after a network failure is resolved by retrying the same operation ID.
- Side effects such as tasks, invitations, and jobs use the same transaction or their own downstream idempotency key.

## 10. Pull Protocol

The client requests changes after its durable cursor:

```text
GET /v1/sync/changes?after=<opaqueCursor>&limit=<boundedLimit>
```

The server returns changes in deterministic sequence order plus the next cursor. A change contains enough information to upsert or delete an authorized local read-model record.

The client applies each page in one SQLite transaction and advances the cursor only in that same transaction.

## 11. Authorization Changes

If a user loses garden access:

- The server emits an authorization revocation change or returns a partition reset instruction.
- The client removes protected local garden data after preserving only policy-approved conflict or export recovery information.
- Pending operations against the garden become rejected and cannot be retried under stale authorization.

Membership grants cause the garden partition to be included in subsequent synchronization.

Organization membership alone never causes a garden partition grant. An active garden assignment or operational membership is required.

Client engagement grants do not include the operational garden partition. The initial responsive web portal queries publication-only endpoints online. A future native client portal must use a separate read-only publication partition and cannot reuse operational records.

## 12. Initial Synchronization

Initial sync uses a consistent bounded snapshot:

1. Authenticate and register or refresh client installation metadata.
2. Fetch authorized garden summaries.
3. Select or open a garden partition.
4. Download snapshot pages tied to a snapshot boundary.
5. Apply pages transactionally.
6. Save the boundary as the pull cursor.
7. Begin incremental changes.

If snapshot retention expires before completion, the client restarts cleanly without mixing boundaries.

## 13. Full Resynchronization

A full resync is required when:

- The server change cursor is older than retained history.
- Local schema or data integrity cannot be migrated safely.
- Authorization partitions changed incompatibly.
- Protocol version is unsupported.

Pending outbox operations are exported to a protected recovery area before replacing server-derived read models. They are replayed only after compatibility validation.

## 14. Conflict Categories

### 14.1 Independent Objects

Changes to different object IDs merge naturally through independent revisions.

### 14.2 Same Mutable Object

A stale expected revision returns a conflict containing the current authorized representation, current revision, and stable conflict type. The original local command remains recoverable.

### 14.3 Append-Only Records

Observations with unique IDs normally append without conflict. Server validation may reject duplicates, unauthorized targets, or invalid references.

### 14.4 Task State

Task transitions are commands. Completing an already completed task may be idempotent; completing a cancelled or superseded task returns a domain conflict.

### 14.5 Geometry

Stale changes to the same geometry revision are not automatically last-write-wins merged. The user may:

- Keep the server version.
- Reapply the local intent to the current version where the operation is safely replayable.
- Open both versions for manual review.
- Duplicate as a new object when semantically valid.

A command is safely replayable when resubmitting its exact local intent against the current revision cannot itself misapply the mutation:

- A command carrying a relative change (a translation delta, for example) is safely replayable against any base geometry by construction.
- A command carrying an absolute index or position that assumed a specific prior geometry shape (a vertex index, a split point) is not safely replayable when the current geometry may have a different shape — reapplying could target the wrong element or fail structurally. Manual review is offered instead.
- A command carrying a complete new value (a full geometry replacement, a full property set) rather than one derived from the prior state is safely replayable regardless of shape, since the new value does not depend on what the prior shape was.
- A command touching more than one record with independent revisions (joining or splitting linework) is not safely replayable through this mechanism, since one corrected revision cannot vouch for more than one record at once.

Duplicate as a new object materializes this device's own currently known version of the object as a brand-new record, independent of which specific command produced it — it is offered only when exactly one record is unambiguously implicated and a create-equivalent command exists for that record type. The client's own per-command classification (`apps/ios/Sources/CoreSynchronization/ConflictRecoveryPolicy.swift`) is the authoritative, tested reference; the same principle applies to any other client implementing this recovery flow.

### 14.6 Generated Proposals

Processing results never overwrite accepted geometry. Proposal acceptance is a revision-aware command and can conflict if the garden changed during processing.

## 15. Local Conflict Recovery

Conflicts are durable records containing:

- Original operation.
- The record type the conflict belongs to.
- Local optimistic representation.
- Current server representation or authorized summary.
- Conflict code.
- Suggested recovery actions.
- Resolution operation when selected.

Resolving a conflict creates a new outbox command and closes the prior conflict only after the resolution is accepted. The resolution command carries a reference back to the conflict it resolves, so the client can make that closing connection generically once the command's own push outcome is confirmed, without record-type-specific knowledge in the engine itself. Keeping the server version has no server round trip and closes the conflict immediately; reapplying the local intent and duplicating as a new object both enqueue a new command and only close the conflict once that command is later confirmed.

## 16. Ordering

Operations preserve order only where domain dependencies require it. Examples:

- Create garden before creating its object.
- Register media before attaching it to an observation.
- Create fence before adding its gate.

Independent operations should not be blocked by one failed command. Dependency IDs make blocking explicit.

## 17. Deletion and Tombstones

Deletions produce server tombstones in the sync change log. Tombstones include record identity, type, garden, accepted revision, and sequence.

Tombstone retention must cover the maximum supported offline duration. When it cannot, the server forces a partition resnapshot.

## 18. Media Coordination

Record sync contains media IDs and state, not binary data.

An operation that references media declares whether it may be accepted before upload completion. For example:

- A new observation may sync with `mediaPending` and attach the media after verification.
- A scan-processing command requires verified source media and remains dependency-blocked until then.

Media upload retry and sync retry are separately observable.

## 19. Background Execution

The native client runs synchronization:

- While foregrounded.
- During approved background refresh opportunities.
- After background uploads complete.
- On explicit user request.

The engine assumes background time may end immediately. It checkpoints after every accepted push result and pulled page.

## 20. Connectivity and Backoff

- Network reachability is a hint, not proof of service access.
- Retry uses exponential backoff with jitter.
- Authentication, authorization, validation, and conflict failures do not retry automatically as transient failures.
- `Retry-After` is honored.
- User-initiated retry can wake eligible work without creating duplicate operation IDs.

## 21. Protocol Versioning

The client sends its sync protocol version and operation payload version. The server supports a defined mobile release window.

- Additive response fields are ignored by older clients.
- Command payload evolution uses explicit versions and upcasters where safe.
- Unsupported clients receive an upgrade-required state without losing their local outbox.

## 22. Security

- Every push operation is reauthorized against current server membership.
- The server ignores client-submitted actor and role claims.
- Change pull is partitioned by current authorization.
- Conflict responses do not disclose inaccessible versions.
- App Check enforcement is progressive but does not replace authentication.
- Device installation identifiers are application-scoped and revocable.

## 23. Observability

Measure:

- Pending outbox age and count.
- Push acceptance, duplicate, conflict, rejection, and retry rates.
- Pull lag and batch duration.
- Full resync frequency.
- Authorization-revocation cleanup.
- Media dependency delay.
- Protocol-version distribution.

Telemetry excludes command payloads, exact geometry, notes, and private media details.

## 24. Testing Matrix

Tests cover:

- Offline create, update, and delete.
- Lost response after accepted server commit.
- Duplicate batch submission.
- Partial batch success.
- Same-object geometry conflict.
- Independent-object merge.
- Authentication expiration.
- Membership removal while offline.
- Organization membership without garden assignment.
- Client engagement accidentally requesting operational sync.
- Publication withdrawal or engagement revocation between list and detail requests.
- Tombstone application.
- Cursor expiration and full resync.
- Schema upgrade with pending outbox.
- Media upload before and after record sync.
- Process termination during push and pull.
- Clock skew.
- Large backlog with bounded memory.

Tests use deterministic server and local database fixtures and run fault injection at every checkpoint.

## 25. Completion Criteria

- Every offline-capable mutation is atomic with an outbox record.
- Retrying cannot duplicate accepted effects.
- Pull cursor advancement is atomic with local application.
- Same-geometry conflicts never silently discard user work.
- Media and record synchronization recover independently.
- Access revocation removes protected local data.
- Client access cannot enumerate or synchronize operational garden records.
- Mobile upgrades preserve pending operations or provide explicit recovery.
