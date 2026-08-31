# GG-0002: Archive-first permanent deletion without a mandatory recovery delay

| Field          | Value                |
| -------------- | -------------------- |
| Status         | `analyzed`           |
| Severity       | `SEV-5`              |
| Surface        | `web`, `API`, `data` |
| Code finding   | `supported`          |
| First reported | `2026-08-31`         |
| Last updated   | `2026-08-31`         |

## Summary

Product decision: a user-facing entity must be archived before it can be permanently deleted.
Permanent deletion must be a separate destructive action with explicit confirmation and must not
impose the current roughly one-month recovery delay. This is a new requirement, not a request to
change application code during testing.

The current garden flow is the clearest mismatch: it allows deletion directly from `active` or
`archived`, always stamps a 30-day recovery deadline, and remains recoverable even after that
deadline until the deletion sweep claims it. In `verdery-dev` the workers service is not deployed,
so the sweep does not run and a requested deletion can remain pending indefinitely.

## Observations

| Observation | Date       | Surface and version                         | Expected                                                                                                     | Actual                                                                                                                                                                                                        | Reproducibility |
| ----------- | ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| OBS-002     | 2026-08-31 | Web 0.6.1 repository / deployed development | Archive first; then choose a distinct, explicitly confirmed irreversible deletion without a month-long wait. | Garden deletion is available without prior archive and starts an unconditional 30-day recovery window. Account deletion shares the same policy; other entities use several incompatible meanings of “delete.” | always          |

## Code analysis

### Finding

The current behavior and the requirement gap are supported by the code. The phrase “item/entity”
does not safely imply that every row in the product should gain hard deletion, so scope is recorded
by existing user-facing behavior:

| Entity                                  | Current user-facing behavior                                                                                                                                                                                                                    | Requirement fit and scope conclusion                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Garden                                  | Web exposes separate Archive and Delete buttons, but Delete is available from `active`; the API accepts `active` or `archived`, changes state to `deletionRequested`, and waits at least 30 days before purge. There is no unarchive operation. | **Confirmed primary scope.** Enforce `archived` as the server-side precondition, add restore-from-archive, and replace or supplement the recovery request with a distinct irreversible purge action.                                                             |
| Account                                 | API-only web gap: request deletion disables ordinary access and starts the same 30-day window; no web component calls the account-deletion operations.                                                                                          | **Related policy, not automatically an “archive item.”** The user rejects its shared delay, but account deactivation/archive semantics and web entry point need an explicit product decision. Separate its policy from the garden constant if behavior diverges. |
| Plant candidate                         | Already has `archived` status and a distinct genuine permanent-delete endpoint with an inline two-step confirmation. The endpoint still permits deletion from `active`, `rejected`, or `archived`.                                              | **Directly applicable precedent.** Add an archived-state precondition in both API and UI; retain the existing dependency guard for converted candidates.                                                                                                         |
| Plant                                   | Status includes `archived`; the UI's “Delete plant” only changes status to `removed`. There is no hard-delete operation. Plants may own observations, photos, tasks, map placement, and conversion provenance.                                  | **Likely affected, but requires a deletion design.** Do not equate `removed` with permanent deletion or add row deletion until dependent-history policy is defined.                                                                                              |
| Task                                    | “Delete” is only a terminal `deleted` status and preserves the row/activity; there is no `archived` status or hard delete.                                                                                                                      | **Needs a product scope decision.** Applying the rule requires new lifecycle semantics and an audit/history retention decision.                                                                                                                                  |
| Map object                              | `deleteObject` is a reversible soft lifecycle transition with `restoreObject`/undo; no archive or hard-delete command exists.                                                                                                                   | **Do not generalize automatically.** Archive may be redundant with its current reversible delete model, while hard deletion would affect revision journals, sync tombstones, geometry references, and undo.                                                      |
| Original media                          | Delete immediately revokes access and schedules asynchronous byte deletion; there is no 30-day recovery window or archive state. Referenced media is protected.                                                                                 | **Not supported as part of the month-delay complaint.** A new archive prerequisite would need separate media-product justification. Worker absence is nevertheless an operational blocker to completion in development.                                          |
| Observation and published/audit history | Observations are append-oriented and corrected by successor records; publication/work/audit records intentionally survive some subject purges. No ordinary observation hard-delete UI was found.                                                | **Excluded absent a separate retention/privacy decision.** Permanent deletion must not silently erase required provenance or records promised to survive a purge.                                                                                                |

Garden and candidate behavior are one requirement because they already expose both archive and
delete concepts. The remaining entities are impact analysis, not an assertion that identical
archive states should be added everywhere.

### Requirements

1. For every entity explicitly covered by this requirement, the API must reject permanent deletion
   unless the current lifecycle is `archived`; hiding the control in web UI is not sufficient.
2. Archiving must remain reversible and non-destructive. A covered entity needs an explicit
   unarchive/restore action before permanent deletion, including gardens, which currently lack it.
3. Permanent deletion must be a separately named destructive action, visually separated from
   Archive and unavailable in the active state. Its confirmation must state that recovery is
   impossible, identify the exact entity, summarize dependent data/access impact, and require a
   deliberate second action. High-impact subjects should require recent authentication; a native
   `window.confirm` alone is not an adequate long-form impact review.
4. Confirmation starts the irreversible path immediately: transition atomically to a non-restorable
   `purging`/equivalent state, revoke access and edits, enqueue or execute the existing idempotent
   purge, and expose progress/failure honestly. “No recovery delay” does not promise synchronous
   physical deletion of remote bytes or immutable backups.
5. Preserve existing concurrency, authorization, idempotency, audit, sync-tombstone, media-absence,
   and purge-resume safeguards. Permanent deletion must never bypass dependency checks merely to
   become faster.
6. Shared ownership must be resolved before confirmation. The UI must disclose which collaborators,
   memberships, client publications, and owned data are affected. The product must decide whether
   a co-owned garden can be destroyed by one owner, requires ownership transfer, or is ineligible.
7. User-facing copy must distinguish `Archived`, `Permanent deletion pending`, and `Permanently
deleted`; it must also disclose that operational backups and legally retained audit/tombstone
   records expire under their own policies rather than claiming instantaneous erasure everywhere.

### Evidence

- `apps/web/features/gardens/garden-danger-zone.tsx` — Archive and Delete are separate, but both are
  available while active and use browser-native confirmation.
- `services/api/src/modules/gardens-mapping/domain/garden.ts` — `requestGardenDeletion` accepts both
  active and archived states; archive is one-way; restoration exists only for a pending deletion.
- `services/api/src/shared/deletion/deletion-policy.ts` — one unconditional 30-day constant shared
  by garden and account deletion.
- `packages/api-contracts/openapi/paths/gardens/gardens_gardenId_delete-request.yaml` — the 30-day
  garden request/restore contract and recent-authentication gate.
- `packages/api-contracts/openapi/paths/account/account_deletion.yaml` — account access disablement,
  the same 30-day window, ownership resolution, and explicit absence of immediate deletion.
- `docs/development/runbooks.md` and `README.md` — `verdery-workers-dev` is not deployed; deletion
  and media sweeps therefore do not complete in the development environment.
- `apps/web/features/candidates/candidate-delete-control.tsx` and
  `packages/api-contracts/openapi/paths/plant-candidates/gardens_gardenId_plant-candidates_candidateId.yaml`
  — existing archive/permanent-delete precedent and explicit confirmation, without an archive
  precondition.
- `apps/web/features/plants/plant-delete-section.tsx` and
  `apps/web/features/plants/plant-lifecycle-controls.tsx` — plant Archive exists, while Delete is
  only status `removed` and no hard-delete command exists.
- `packages/api-contracts/openapi/paths/tasks/gardens_gardenId_tasks_taskId_delete.yaml` and
  `services/api/src/modules/gardens-mapping/application/delete-map-object.ts` — task and map Delete
  are retained soft transitions, not permanent deletion.
- `packages/api-contracts/openapi/paths/media/gardens_gardenId_media_mediaId_delete.yaml` — media
  deletion is asynchronous, dependency-protected, and already has no 30-day recovery delay.

### Affected surface

- Confirmed: garden settings/list lifecycle UI, candidate detail/status UI, their gateways, OpenAPI
  operations, domain preconditions, persistence, audit, sync, and automated tests.
- Related: account deletion policy and future web UI.
- Conditional on product decisions: plants, tasks, and map objects.
- Operational prerequisite: a deployed deletion/media worker or another durable executor; otherwise
  removing the delay changes a deadline but cannot complete a purge.

### Likely cause

Deletion behavior was built in separate phases with different meanings: garden/account “delete” is
a delayed recoverable workflow, candidate delete is a real row removal, and plant/task/map delete
is a status transition. The new decision establishes one user mental model, but the implementation
does not yet have a shared archive/permanent-delete vocabulary or lifecycle contract.

## Reproduction and validation

1. In an active garden's settings, observe that Archive and Delete are simultaneously available.
2. Choose Delete and confirm that the returned garden is `deletionRequested` with a deadline 30
   days later; observe the same deadline in the garden list.
3. Verify that a candidate can be permanently deleted without first setting status to `archived`.
4. For implementation validation, add contract/domain/UI tests proving active deletion is rejected,
   archived deletion requires explicit confirmation and recent authentication where applicable,
   unarchive is possible before deletion, the irreversible transition has no recovery deadline,
   shared/dependent data rules hold, and the purge resumes idempotently after interruption.
5. Run the purge with real workers and verify active database rows, media objects, Firebase identity
   where applicable, sync convergence, retained tombstones, and audit evidence separately.

## Migration and compatibility risks

- Existing `deletionRequested` gardens/accounts cannot be silently converted to `archived`: their
  memberships and access have already been revoked. They need an explicit grandfathering policy,
  such as keeping legacy recovery or offering the new irreversible confirmation from the pending
  state.
- Removing or changing existing operations is an API compatibility break for generated TypeScript
  and Swift clients and queued offline commands. Prefer additive operations and versioned lifecycle
  handling until old clients age out.
- A direct `archived → purging` transition must still create the deletion record/checkpoints and
  revocation tombstones the current `deletionRequested → purging` sweep produces.
- Hard-deleting plants, tasks, or map objects would collide with foreign keys, append-only history,
  revision journals, audit evidence, publications, exports, and offline synchronization. Each needs
  an explicit survivor/cascade matrix before schema migration.
- Backups retain deleted database state for their configured window and Cloud Storage soft delete
  retains objects for seven days. Product copy and privacy documentation must remain accurate.

## Resolution

Pending implementation and the open scope decisions above. No application code or existing
deletion state was changed during analysis.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- |
| 2026-08-31 | OBS-002 and the archive-first permanent-deletion product decision recorded and analyzed. |
