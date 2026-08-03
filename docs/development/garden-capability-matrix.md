# Operational garden capability matrix (P9A-CAP-01)

> Status: frozen vocabulary for P9A. Every later P9A work package tests against this document.
> Last updated: July 26, 2026

This document freezes what `owner`, `editor`, and `viewer` may and may not do on an operational
garden, across the nine areas P9A-CAP-01 names: garden content, tasks, accepted history, raw media,
expensive processing, export, publication, membership, and deletion.

It is a specification plus a gap analysis, not a description of shipped behaviour. Section 4 states
the intended rule for every capability; the last column of each table says whether the code enforces
it today, and section 6 lists every place it does not. Where a row's rule is not yet enforced, the
row is still binding: the gap is the work order, not a licence to behave differently.

**Non-goals.** The client publication plane (`client_engagement`, publisher capability, portal
access) belongs to P9B/P9C and does not exist in any form in this repository. Section 4.7 states its
role rules anyway — the operational roles must not silently acquire publication power — and marks
every row as not implemented. Service organizations (`organization_admin`, `professional`) are
likewise out of scope: this document covers the three operational garden roles only.

---

## 1. How to read a cell

Every cell is **Allowed** or **Denied**. There are no blanks, no "TBD", and no "depends": where a
capability is conditional, the condition is part of the cell ("Allowed (recent auth ≤ 30 min)") or,
where it applies to the whole row, part of the rule column. A cell that reads "Denied" means the
server must refuse the operation, not that the UI hides it.

Four preconditions hold for **every** row in section 4 and are never repeated:

1. **Authenticated.** A verified Firebase ID token or session cookie; CSRF proof on cookie
   mutations. `services/api/src/platform/authentication/authentication-plugin.ts:100-111`.
2. **Account usable.** `isAccountUsable(profile.accountState)` is `true`, i.e. the account is
   `active`. `services/api/src/modules/identity-access/domain/account-state.ts:22-24`, enforced at
   `authentication-plugin.ts:115-124`. The single exception is the three account-deletion routes,
   which additionally admit `deletion_requested` (`services/api/src/app.ts:527-537`).
3. **Active membership.** The capability check resolves `collaboration.membership` rows with
   `state = 'active'` only, and on a garden row that still exists. `kysely-membership-repository.ts:35-68`.
4. **Concealment.** No membership at all is answered `404 notFound`; membership without the
   capability is answered `403 forbidden`. `garden-authorization.ts:55-70`. Therefore a "Denied"
   cell for a role that is a member surfaces as `403`; a non-member's denial surfaces as `404`.

Terms used in the rules column:

- **`viewGarden` / `editGardenContent` / `manageGarden` / `exportGarden`** — the four capabilities
  that exist in code today (`gardens-mapping/domain/garden-role.ts:23-39`).
- **Recent auth** — the session's own Firebase `auth_time` is at most 30 minutes old. Never a
  client-supplied instant. `shared/deletion/deletion-policy.ts:41,58-71` and
  `exports/domain/export-request.ts:50,83-95`.
- **Not implemented** — no code path exists; the row is a requirement on a later work package.

---

## 2. The normative source, and where it is silent

The authority is [`../architecture/identity-and-authorization.md`](../architecture/identity-and-authorization.md),
section "8. Operational Garden Roles" (lines 130-162), with sections "10. Invitations" (216-236) and
"11. Ownership Transfer" (238-249) for the membership area. Its role definitions, verbatim:

| Role   | Document text                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner  | "View and edit all garden content. Manage membership and roles. Configure garden-level settings. Export garden data. Delete or transfer the garden subject to policy." Multiple active owners are allowed. (134-142) |
| Editor | "View and edit garden content. Add media, observations, tasks, and map changes. Run allowed processing within quotas. Cannot change ownership or delete the garden." (144-149)                                       |
| Viewer | "View accepted garden content and permitted history. Cannot mutate domain data or access restricted raw capture artifacts." Internal role; must not be used for professional-service clients. (155-160)              |

Line 162 sets the implementation constraint this matrix exists to serve: "The permission matrix is
implemented as stable capabilities rather than scattered role-name comparisons."

[`../architecture/collaboration-and-client-sharing.md`](../architecture/collaboration-and-client-sharing.md)
section 4 (lines 47-67) restates the same three roles and adds the one sentence that governs the
publication area: "Owner, editor, or professional status alone does not imply publisher access"
(line 65).

**Genuine silences.** The following rows in section 4 have no normative sentence behind them. Each
carries a `†` in its table and is listed here so the owner can ratify or overrule it. These are
positions this document takes because a frozen matrix cannot contain blanks — not positions any
document already holds.

| #   | Question the documents do not answer                                                                                      | Position taken here                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| S1  | May an editor or viewer see the garden's member roster?                                                                   | Allowed, read-only, display name and role only — never email. See §5.5.                                                   |
| S2  | May an editor or viewer read the garden's collaboration audit trail?                                                      | Denied. Audit is administration; §5.6.                                                                                    |
| S3  | May a viewer leave a garden on their own, or does removal always require an owner?                                        | Allowed. Self-removal is not membership administration; §5.7.                                                             |
| S4  | For a client engagement with **no** service organization, who creates and revokes client invitations?                     | Owner only, mirroring line 153's rule for granting the publisher capability. Editor and viewer denied. Ratify before P9C. |
| S5  | May an operational member (any role) read what has been published to a client from their garden?                          | Allowed for all three roles, read-only. It is their own garden's outbound content; §5.8.                                  |
| S6  | Do "editor and viewer export rights are controlled by garden capability" mean they have none by default, or an unset one? | None by default. The capability is owner-only until a product decision widens it; already recorded as deferred. §5.3.     |
| S7  | Is there a numeric per-garden or per-role processing quota behind "run allowed processing within quotas"?                 | No role-scoped quota is specified; the only budgets that exist are per-provider and role-neutral. §5.4.                   |

---

## 3. The mechanism that exists today

Before proposing anything, this is what is actually built.

**One evaluator, two matrices, one table.** `GardenAuthorization.requireCapability(gardenId,
profileId, capability)` (`services/api/src/modules/gardens-mapping/application/garden-authorization.ts:50-83`)
is the single authorization entry point for garden data. It reads the caller's active membership
together with the garden's own lifecycle state, in one joined query
(`kysely-membership-repository.ts:35-68`, filtered `state = 'active'`), then asks two questions:
`roleHasCapability(role, capability)` (`gardens-mapping/domain/garden-role.ts:47-49`) against a
static role matrix, and `capabilityAllowedInLifecycleState(capability, state)` (`garden-role.ts:118-123`)
against a lifecycle matrix:

```ts
// services/api/src/modules/gardens-mapping/domain/garden-role.ts:41-45
const ROLE_CAPABILITIES: Readonly<Record<GardenRole, ReadonlySet<GardenCapability>>> = {
  owner: new Set(['viewGarden', 'editGardenContent', 'manageGarden', 'exportGarden']),
  editor: new Set(['viewGarden', 'editGardenContent']),
  viewer: new Set(['viewGarden']),
};

// services/api/src/modules/gardens-mapping/domain/garden-role.ts:101-108
const CAPABILITY_LIFECYCLE_STATES: Readonly<
  Record<GardenCapability, ReadonlySet<GardenLifecycleState>>
> = {
  viewGarden: new Set(EVERY_LIFECYCLE_STATE),
  editGardenContent: new Set(['active', 'archived']),
  manageGarden: new Set(EVERY_LIFECYCLE_STATE),
  exportGarden: new Set(['active', 'archived', 'deletion_requested']),
};
```

The failure of the first is `403 forbidden`; the failure of the second is
`422 garden.lifecycle_conflict`.

Its behaviour is pinned by `garden-authorization.test.ts` — concealment as `notFound` (line 73),
`forbidden` for a member lacking the capability (79), a three-role parameterised case for
`manageGarden` (95), and a full capability × lifecycle-state sweep (126-152) whose expectation table
is keyed by `GardenCapability`, so a new capability fails to compile until its lifecycle decision is
recorded.

**Storage.** `collaboration.membership` (`migrations/1784736116655_identity-and-gardens-baseline.sql:127-143`)
constrains `role IN ('owner','editor','viewer')` and `state IN ('active','removed')`, unique on
`(garden_id, profile_id)`. There is no last-owner constraint. `collaboration.invitation` exists in
the same migration (lines 151-170) with `intended_role_check CHECK (intended_role IN ('editor',
'viewer'))` — the invitation-cannot-grant-ownership rule is already enforced at the schema level,
against a table nothing writes to. The migration says so itself: "Skeleton only: no invitation
endpoint exists yet" (line 145).

**Reach.** 44 production call sites across seven modules call `requireCapability` — `gardens-mapping`,
`plants-inventory`, `observations-history`, `tasks-recommendations`, `media`, `notifications`, and
`exports`. Two capabilities carry almost all of them: `viewGarden` on every read and
`editGardenContent` on every content mutation.
`manageGarden` is checked in exactly four places, all in `gardens-mapping` (rename, archive, deletion
request, deletion restore); `exportGarden` in exactly one (`exports/application/request-export.ts:83-87`).

**Membership mutation.** There is none, beyond garden creation and deletion.
`MembershipRepository` (`gardens-mapping/application/membership-repository.ts:48-79`) exposes
`insertOwner` (creation) and `setState` (revoke/restore) — **no method changes a role**. Revocation
and restore live in `garden-membership-revocation.ts`, driven only by garden deletion and account
deletion. `activeOwners` (lines 119-125) is the only owner-counting helper and has exactly one
consumer: account deletion's sole-owner branch (`deletion/application/request-account-deletion.ts:161-163`).

**Where role is read outside the matrix.** Six production sites compare a role literal rather than
asking for a capability. Three are decisions, three are values:

| Site                                                                                    | What it decides                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `media/application/get-media-access.ts:88-90`                                           | Denies a viewer a signed URL for `restricted` media     |
| `exports/persistence/kysely-export-snapshot-reader.ts:131-132`                          | Which gardens an account-scope export actually includes |
| `deletion/application/request-account-deletion.ts:161-163`                              | Whether a leaving member's garden dies with them        |
| `exports/persistence/kysely-export-snapshot-reader.ts:103`                              | Hardcoded `role: 'owner'` in the garden-scope listing   |
| `deletion/application/account-deletion-view.ts:81`                                      | Presentation of the sole-owner decision                 |
| `gardens-mapping/application/create-garden.ts:70`, `kysely-membership-repository.ts:70` | Grants the creator `owner` (a write, not a check)       |

The first three are the ones that matter: they are authorization decisions the capability matrix does
not govern. See gaps G-4 and G-5.

---

## 4. The matrix

### 4.1 Garden content

| #   | Capability                                                               | Owner   | Editor  | Viewer  | Rule and enforcement today                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------ | ------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Create a garden                                                          | Allowed | Allowed | Allowed | Role-independent: creation precedes membership, and the creator is granted `owner`. `create-garden.ts:70`                                                                                            |
| A2  | List the gardens one is a member of                                      | Allowed | Allowed | Allowed | Scoped by active membership in the repository, not by capability. `list-gardens.ts:30-35`                                                                                                            |
| A3  | Read garden metadata and one's own role on it                            | Allowed | Allowed | Allowed | `viewGarden`. `get-garden.ts:16-20`; role echoed on the resource, `openapi/components/schemas/gardens.yaml`, `Garden.role`                                                                           |
| A4  | Read the garden map document                                             | Allowed | Allowed | Allowed | `viewGarden`. `get-garden-map.ts:76`                                                                                                                                                                 |
| A5  | Read one map object                                                      | Allowed | Allowed | Allowed | `viewGarden`. `get-map-object.ts:28`                                                                                                                                                                 |
| A6  | Read the map calibration                                                 | Allowed | Allowed | Allowed | `viewGarden`. `get-calibration.ts:37`                                                                                                                                                                |
| A7  | Read plants (get one, search the garden's inventory)                     | Allowed | Allowed | Allowed | `viewGarden`. `get-plant.ts:34`, `search-plants.ts:69`                                                                                                                                               |
| A8  | Search the global taxonomy catalog                                       | Allowed | Allowed | Allowed | Not garden-scoped: no capability is checked and the path's `gardenId` is discarded. `plant-routes.ts:427-431`                                                                                        |
| A9  | Mutate map geometry and objects (11 of the 13 map command types)         | Allowed | Allowed | Denied  | `editGardenContent` on every command. `create-map-object.ts:50` and 10 siblings; see `map-routes.ts:121-219`. A10 and A11 are the other two                                                          |
| A10 | Upsert map calibration                                                   | Allowed | Allowed | Denied  | `editGardenContent`. `upsert-map-calibration.ts:65`                                                                                                                                                  |
| A11 | Accept or reject a generated map proposal                                | Allowed | Allowed | Denied  | `editGardenContent`. `decide-map-proposal.ts:29`                                                                                                                                                     |
| A12 | Create plants and edit plant details, placement, status, and lifecycle   | Allowed | Allowed | Denied  | `editGardenContent` via `require-plant-and-authorize.ts:39` (7 call sites) plus `add-plant.ts:58`                                                                                                    |
| A13 | Rename the garden                                                        | Allowed | Denied  | Denied  | `manageGarden`. `rename-garden.ts:29-33`. Refused outright once deletion is requested (`garden.ts:100-107`)                                                                                          |
| A14 | Archive the garden                                                       | Allowed | Denied  | Denied  | `manageGarden`. `archive-garden.ts:28-32`                                                                                                                                                            |
| A15 | Set one's own notification preferences for a garden                      | Allowed | Allowed | Allowed | `viewGarden`, once per named garden — tuning one's own notifications is a fact of membership. `notification-preference-commands.ts:88-90`                                                            |
| A16 | Mutate garden content while the garden is `deletion_requested`/`purging` | Denied  | Denied  | Denied  | Enforced centrally: `editGardenContent` is refused in those two states by `garden-authorization.ts:74-82`, so every module's content command fails with `422 garden.lifecycle_conflict`. Was gap G-6 |
| A17 | Configure garden-level settings other than the name                      | Allowed | Denied  | Denied  | `manageGarden` when such settings exist. **Not implemented**: no settings surface exists                                                                                                             |

### 4.2 Tasks and recommendations

| #   | Capability                                                                  | Owner   | Editor  | Viewer  | Rule and enforcement today                                                                                                |
| --- | --------------------------------------------------------------------------- | ------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| B1  | List a garden's tasks                                                       | Allowed | Allowed | Allowed | `viewGarden`. `list-tasks-for-garden.ts:33`                                                                               |
| B2  | Read the Today view                                                         | Allowed | Allowed | Allowed | `viewGarden`. `get-today-view.ts:153`. Note this read advances recommendation state — gap G-14                            |
| B3  | Create a manual task                                                        | Allowed | Allowed | Denied  | `editGardenContent`. `create-manual-task.ts:85`                                                                           |
| B4  | Edit a task's details                                                       | Allowed | Allowed | Denied  | `editGardenContent` via `require-task-and-authorize.ts:36`; `edit-task.ts:74`                                             |
| B5  | Reschedule a task                                                           | Allowed | Allowed | Denied  | Same helper. `reschedule-task.ts:64`                                                                                      |
| B6  | Complete a task                                                             | Allowed | Allowed | Denied  | Same helper. `complete-task.ts:56`                                                                                        |
| B7  | Skip a task                                                                 | Allowed | Allowed | Denied  | Same helper. `skip-task.ts:39`                                                                                            |
| B8  | Dismiss a task                                                              | Allowed | Allowed | Denied  | Same helper. `dismiss-task.ts:44`                                                                                         |
| B9  | Delete a task (soft — status becomes `deleted`, no row is removed)          | Allowed | Allowed | Denied  | Same helper. `delete-task.ts:41`                                                                                          |
| B10 | Attach a media file to a task                                               | Allowed | Allowed | Denied  | Same helper. `attach-task-file.ts:52`                                                                                     |
| B11 | Hard-delete a task row                                                      | Denied  | Denied  | Denied  | No such command exists; deletion is a status transition. `delete-task.ts:1-3`                                             |
| B12 | Give recommendation feedback (complete, postpone, dismiss, mark irrelevant) | Allowed | Allowed | Denied  | `editGardenContent` via `require-recommendation-and-authorize.ts:34`; `recommendation-feedback-commands.ts:160`           |
| B13 | Convert a recommendation into a task                                        | Allowed | Allowed | Denied  | Same helper. `convert-recommendation-to-task.ts:82`                                                                       |
| B14 | Assign a task to another member                                             | Allowed | Allowed | Denied  | **Not implemented** (P9A-TASK-01). Assignee must hold `editGardenContent`; assigning to a viewer is Denied for all actors |
| B15 | Reassign or unassign a task assigned to someone else                        | Allowed | Allowed | Denied  | **Not implemented** (P9A-TASK-01)                                                                                         |
| B16 | Receive an assignment                                                       | Allowed | Allowed | Denied  | **Not implemented** (P9A-TASK-01). A viewer cannot complete work, so a viewer cannot hold an assignment                   |
| B17 | Read who completed a task and when (actor attribution)                      | Allowed | Allowed | Allowed | **Not implemented** as a readable field (P9A-TASK-01). `actorProfileId` is recorded on audit and idempotency rows only    |

### 4.3 Accepted history (observations)

Observations are this codebase's accepted history: an append-only family with no `revision` column
and no UPDATE path (`observations-history/domain/observation.ts:1-16`). Correction is a new row
pointing backwards, never a mutation.

| #   | Capability                                                | Owner   | Editor  | Viewer  | Rule and enforcement today                                                                                                  |
| --- | --------------------------------------------------------- | ------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| C1  | List a garden's observations, including correction status | Allowed | Allowed | Allowed | `viewGarden`. `list-observations-for-garden.ts:14`                                                                          |
| C2  | List one plant's observations                             | Allowed | Allowed | Allowed | `viewGarden`. `list-observations-for-plant.ts:22`                                                                           |
| C3  | Record an observation                                     | Allowed | Allowed | Denied  | `editGardenContent`. `record-observation.ts:54`                                                                             |
| C4  | Correct an observation one authored                       | Allowed | Allowed | Denied  | `editGardenContent`, evaluated against the **original row's** garden. `correct-observation.ts:61-66`                        |
| C5  | Correct an observation another member authored            | Allowed | Allowed | Denied  | Same check; there is deliberately no author comparison. See §5.2                                                            |
| C6  | Mutate an existing observation row in place               | Denied  | Denied  | Denied  | Structurally impossible: no update path and no revision column. `observation.ts:1-16`                                       |
| C7  | Delete an observation                                     | Denied  | Denied  | Denied  | No command, no route, no repository method. The only removal is garden/account purge (`deletion/application/purge-plan.ts`) |

### 4.4 Raw and ordinary media

| #   | Capability                                                                  | Owner   | Editor  | Viewer  | Rule and enforcement today                                                                                             |
| --- | --------------------------------------------------------------------------- | ------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1  | List a garden's original media records                                      | Allowed | Allowed | Allowed | `viewGarden`. `list-garden-media.ts:39`                                                                                |
| D2  | Read one media record's status and its display derivatives                  | Allowed | Allowed | Allowed | `viewGarden` via `require-media-and-authorize.ts:39`; `get-media-status.ts:42`                                         |
| D3  | Read the product-wide media retention policy                                | Allowed | Allowed | Allowed | Not garden-scoped; authenticated callers only. `media-routes.ts:382`                                                   |
| D4  | Obtain a short-lived signed URL for **ordinary** media (not `restricted`)   | Allowed | Allowed | Allowed | `viewGarden` plus availability. `get-media-access.ts:68-86`                                                            |
| D5  | Obtain a short-lived signed URL for **`restricted`** media (raw capture)    | Allowed | Allowed | Denied  | Role literal, not a capability: `get-media-access.ts:88-90`. Every grant is audited (`:101-110`). Gap G-5              |
| D6  | Register a media upload                                                     | Allowed | Allowed | Denied  | `editGardenContent`. `register-media-upload.ts:87`                                                                     |
| D7  | Complete a media upload (which triggers validation and derivative jobs)     | Allowed | Allowed | Denied  | `editGardenContent`. `complete-media-upload.ts:87`                                                                     |
| D8  | Delete a garden's media                                                     | Allowed | Allowed | Denied  | `editGardenContent`. `delete-garden-media.ts:70`                                                                       |
| D9  | Bypass the restricted-media denial through an "explicitly allowed" override | Denied  | Denied  | Denied  | The override `media-storage-and-processing.md:277` contemplates has no mechanism anywhere. `get-media-access.ts:16-19` |

### 4.5 Expensive processing

"Run allowed processing within quotas" is an editor right in the normative document
(`identity-and-authorization.md:148`). In this codebase, no user-initiated request reaches an
external AI provider: every expensive path is either a stub or a scheduled sweep running under a
service identity.

| #   | Capability                                                                                                        | Owner   | Editor  | Viewer | Rule and enforcement today                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Trigger media validation and derivative generation (via completing an upload)                                     | Allowed | Allowed | Denied | `editGardenContent`. `complete-media-upload.ts:87`                                                                                                            |
| E2  | Submit a photo for plant identification                                                                           | Allowed | Allowed | Denied | `editGardenContent`. `add-plant-from-photo.ts:64`. The identifier is a stub with no provider call (`identify-plant-from-photo.ts:22-24`)                      |
| E3  | Confirm a proposed identification onto a plant                                                                    | Allowed | Allowed | Denied | `editGardenContent`. `confirm-plant-identification.ts:35`. Identification never auto-confirms (`add-plant-from-photo.ts:98-99`)                               |
| E4  | Trigger AI explanation generation on demand                                                                       | Denied  | Denied  | Denied | No user-facing trigger exists by design: it runs only as a sweep phase (`embellish-recommendation-explanations.ts:1-9`)                                       |
| E5  | Invoke the recommendation-evaluation, weather-refresh, media-retention, notification-delivery, or deletion sweeps | Denied  | Denied  | Denied | Service identity only, on `/internal/*` routes outside the authenticated context. `app.ts:459-486`                                                            |
| E6  | Consume provider calls beyond the configured hourly/daily budget                                                  | Denied  | Denied  | Denied | Per-provider, role-neutral, consumed before the call. `generate-ai-explanation.ts:118-125`                                                                    |
| E7  | Continue uploading media past any per-garden or per-role storage ceiling                                          | Allowed | Allowed | Denied | Allowed because **no numeric ceiling exists**; a viewer is denied only because a viewer cannot upload at all. `quota-reservation-repository.ts:21-25`. See S7 |

### 4.6 Export

| #   | Capability                                                     | Owner                        | Editor                       | Viewer                       | Rule and enforcement today                                                                                           |
| --- | -------------------------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F1  | Request a garden-scoped export                                 | Allowed                      | Denied                       | Denied                       | `exportGarden`. `request-export.ts:83-87`. No recent-auth gate on this scope today — gap G-7                         |
| F2  | Request an account-scoped export                               | Allowed (recent auth ≤ 30 m) | Allowed (recent auth ≤ 30 m) | Allowed (recent auth ≤ 30 m) | Account-scoped, so no garden capability is consulted. `request-export.ts:78-79`                                      |
| F3  | Have a given garden's content included in one's account export | Allowed                      | Denied                       | Denied                       | Decided by a role literal in persistence, not by `exportGarden`. `kysely-export-snapshot-reader.ts:131-132`. Gap G-4 |
| F4  | Have raw-capture artifacts included in any export              | Denied                       | Denied                       | Denied                       | Excluded entirely — files and metadata — and disclosed in the manifest. `deferred-capabilities.md:904-906`           |
| F5  | Read the status of, and download, an export one requested      | Allowed                      | Allowed                      | Allowed                      | Requester-scoped, not role-scoped. `get-export-request.ts:17-20`, `get-export-download.ts:37-40`                     |
| F6  | Read or download an export another profile requested           | Denied                       | Denied                       | Denied                       | Same requester-scoped lookup returns not-found. `get-export-download.ts:37-40`                                       |
| F7  | Hold more than one in-flight export at a time                  | Denied                       | Denied                       | Denied                       | One active export per requester, unique-index enforced. `request-export.ts:102-105,160-162`                          |

### 4.7 Publication — P9C, not implemented

**Nothing in this section exists in code.** There is no `client_engagement`, no publisher
capability, no publication table, and no client route. The rows exist so that no later package can
grant publication power by widening an operational role, and so that P9C's tests have a positive and
negative statement to test against. Every row is **not implemented**.

| #   | Capability                                                                                      | Owner                                      | Editor                                     | Viewer  | Rule                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------- |
| G1  | Grant or revoke the client-publisher capability, for an engagement with no service organization | Allowed                                    | Denied                                     | Denied  | `identity-and-authorization.md:153`; `collaboration-and-client-sharing.md:65`                               |
| G2  | Create or edit a client update draft                                                            | Denied unless separately granted publisher | Denied unless separately granted publisher | Denied  | Publication is never implied by an operational role. `identity-and-authorization.md:151-153`                |
| G3  | Publish a client update (`draft → ready_for_client → published`)                                | Denied unless separately granted publisher | Denied unless separately granted publisher | Denied  | Same rule. Completing a task must never publish it automatically (`implementation-plan.md` P9C-PUBLISH-01)  |
| G4  | Withdraw a published version                                                                    | Denied unless separately granted publisher | Denied unless separately granted publisher | Denied  | Same rule                                                                                                   |
| G5  | Create or revoke a client invitation for an engagement with no service organization †           | Allowed                                    | Denied                                     | Denied  | S4: the documents do not name the inviter for an organization-less engagement. Owner by analogy with G1     |
| G6  | Read what has already been published to a client from this garden †                             | Allowed                                    | Allowed                                    | Allowed | S5: outbound content of one's own garden, read-only                                                         |
| G7  | Reuse an operational membership as client portal access                                         | Denied                                     | Denied                                     | Denied  | "A client is never implemented as an operational viewer." `collaboration-and-client-sharing.md:22`, line 61 |
| G8  | Receive the operational sync partition through a client engagement                              | Denied                                     | Denied                                     | Denied  | `offline-synchronization.md:138`                                                                            |

### 4.8 Membership

Three rows are enforced today: H1 (the role echoed on the garden resource), H4 (by a database CHECK
on a table nothing writes to), and H15 (by membership state). The other twelve are the work order
for P9A-API-01 and P9A-OWNER-01; see gaps G-1, G-2, G-3.

| #   | Capability                                                            | Owner                                                                                   | Editor  | Viewer  | Rule and enforcement today                                                                                                                             |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | See one's own role on a garden                                        | Allowed                                                                                 | Allowed | Allowed | Echoed on the garden resource from the caller's own membership. `openapi/components/schemas/gardens.yaml`, `Garden.role`                               |
| H2  | See the garden's member roster (display name and role; never email) † | Allowed                                                                                 | Allowed | Allowed | S1. **Not implemented**: no membership endpoint exists                                                                                                 |
| H3  | Create an ordinary invitation with intended role `editor`/`viewer`    | Allowed                                                                                 | Denied  | Denied  | `identity-and-authorization.md:220-222`. **Not implemented**; schema-ready (`migration:151-170`)                                                       |
| H4  | Create an invitation with intended role `owner`                       | Denied                                                                                  | Denied  | Denied  | Possession of a token must never grant owner administration. Enforced by `invitation_intended_role_check`                                              |
| H5  | Revoke a pending invitation                                           | Allowed                                                                                 | Denied  | Denied  | **Not implemented** (P9A-API-01)                                                                                                                       |
| H6  | Accept an invitation addressed to oneself                             | Allowed                                                                                 | Allowed | Allowed | Role-independent: the acceptor has no membership yet. Conditions: pending, unexpired, verified-email match when bound, idempotent. **Not implemented** |
| H7  | Change another member's role between `editor` and `viewer`            | Allowed                                                                                 | Denied  | Denied  | **Not implemented**. `MembershipRepository` has no role-update method at all (`membership-repository.ts:48-79`)                                        |
| H8  | Promote an active member to `owner`                                   | Allowed (recent auth ≤ 30 m, target has active membership, audited)                     | Denied  | Denied  | `identity-and-authorization.md:222`, `238-247`. **Not implemented**                                                                                    |
| H9  | Demote an `owner` to `editor`/`viewer`                                | Allowed (recent auth ≤ 30 m, and at least one other active owner remains)               | Denied  | Denied  | **Not implemented**; last-owner invariant has no enforcement anywhere. Gap G-2                                                                         |
| H10 | Take any action that leaves an active garden with no active owner     | Denied                                                                                  | Denied  | Denied  | "A garden must always have at least one owner unless it is in a deletion workflow." `identity-and-authorization.md:249`                                |
| H11 | Remove another member                                                 | Allowed                                                                                 | Denied  | Denied  | "Editor does not imply membership administration." `collaboration-and-client-sharing.md:57`. **Not implemented**                                       |
| H12 | Remove oneself from a garden †                                        | Allowed (only if another active owner remains)                                          | Allowed | Allowed | S3. **Not implemented** as an explicit command; account deletion already performs the equivalent (`request-account-deletion.ts:190-201`)               |
| H13 | Transfer ownership to another member                                  | Allowed (recent auth ≤ 30 m, target active, explicit confirmation, audited, idempotent) | Denied  | Denied  | `identity-and-authorization.md:238-247`. **Not implemented**                                                                                           |
| H14 | Read the garden's collaboration audit trail †                         | Allowed                                                                                 | Denied  | Denied  | S2. **Not implemented**: `AuditLogger` writes events, nothing reads them per garden                                                                    |
| H15 | Regain access after removal without a fresh invitation                | Denied                                                                                  | Denied  | Denied  | Membership is revoked by state, and the next server operation refuses. `identity-and-authorization.md:373`                                             |

### 4.9 Deletion

| #   | Capability                                                               | Owner                                    | Editor                       | Viewer                       | Rule and enforcement today                                                                                                             |
| --- | ------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Request garden deletion (opens the 30-day recovery window)               | Allowed (recent auth ≤ 30 m, `If-Match`) | Denied                       | Denied                       | `manageGarden` then recent auth. `request-garden-deletion.ts:63-68`                                                                    |
| I2  | Withdraw a garden deletion request inside the window                     | Allowed (recent auth ≤ 30 m)             | Denied                       | Denied                       | `manageGarden`. `restore-garden-deletion.ts:53-57`. Non-owners were already revoked at request time, so their denial surfaces as `404` |
| I3  | Mutate garden content while the garden is `deletion_requested`/`purging` | Denied                                   | Denied                       | Denied                       | Required by `data-export-and-deletion.md` section 10.1 step 3, enforced by the capability lifecycle matrix (§3). Was gap G-6           |
| I4  | Delete a garden immediately, skipping the recovery window                | Denied                                   | Denied                       | Denied                       | No such command. `data-export-and-deletion.md:305` contemplates it subject to policy; nothing implements it                            |
| I5  | Request deletion of one's own account                                    | Allowed (recent auth ≤ 30 m)             | Allowed (recent auth ≤ 30 m) | Allowed (recent auth ≤ 30 m) | Account-scoped; no garden capability. `request-account-deletion.ts:69`                                                                 |
| I6  | Withdraw one's own account deletion inside the window                    | Allowed (recent auth ≤ 30 m)             | Allowed (recent auth ≤ 30 m) | Allowed (recent auth ≤ 30 m) | `restore-account-deletion.ts:43,56-58`                                                                                                 |
| I7  | Have a garden deleted as a side effect of one's own account deletion     | Allowed (only when sole active owner)    | Denied                       | Denied                       | Sole-ownership resolution; a co-owned garden survives and only the membership is revoked. `request-account-deletion.ts:161-201`        |
| I8  | Delete another member's account                                          | Denied                                   | Denied                       | Denied                       | No mechanism; support access is not an ordinary garden role. `identity-and-authorization.md:286`                                       |
| I9  | Hard-delete an individual task, plant, or observation row                | Denied                                   | Denied                       | Denied                       | Every "delete" in the domain is a soft state transition; only the purge removes rows                                                   |

### 4.10 Cell totals

96 capabilities, 288 cells, no blanks. A cell that reads "Denied unless separately granted
publisher" (G2-G4) counts as Denied: an operational role alone never carries it.

| Role   | Allowed | Denied | Rows |
| ------ | ------- | ------ | ---- |
| Owner  | 73      | 23     | 96   |
| Editor | 55      | 41     | 96   |
| Viewer | 27      | 69     | 96   |

Per area: garden content 17, tasks and recommendations 17, accepted history 7, media 9, expensive
processing 7, export 7, publication 8, membership 15, deletion 9.

**69 of the 96 capabilities are enforced by code today; 27 are not.** The 27 break down as
publication 8, membership administration 12, task assignment and attribution 4, garden-lifecycle
mutability 2 (A16, I3), and garden settings 1 (A17). Section 6 is the itemised list.

---

## 5. Rationale for the non-obvious cells

Cells that follow directly from "owner administers, editor edits, viewer reads" need no defence.
These do.

### 5.1 An editor cannot rename or archive the garden (A13, A14)

Renaming looks like content editing, and a household editor will expect it. It is `manageGarden`
because the garden's name is the garden's identity in every collaborator's list, in export package
manifests, and in notification copy — changing it changes what every other member sees a shared
object called. Archiving is worse: it removes the garden from active use for everyone. The normative
document places "Configure garden-level settings" under owner (line 139) and denies the editor
"destructive garden administration" (`collaboration-and-client-sharing.md:57`). Both are deliberate.

### 5.2 An editor may correct another member's observation (C5)

`CorrectObservation` checks `editGardenContent` on the original row's garden and never compares the
caller against the original's author (`correct-observation.ts:61-66`). This is intentional, and it is
safe precisely because correction is append-only: the original row is never touched, the correction
carries its own actor and timestamp, and readers see both with `isCorrected` set
(`observation-history-details.ts:125`). A shared garden where only the original author can fix an
obvious mistake would either lose the fix or push people into deleting and re-recording — which the
model does not permit anyway. The audit trail, not an author lock, is the control here.

### 5.3 An editor cannot export, at all (F1, F3, S6)

This is the denial most likely to be read as an oversight, so: it is a decision.
`data-export-and-deletion.md:38` says "Editor and viewer export rights are controlled by garden
capability" — it names the control point and grants no default. `exportGarden` therefore starts
owner-only, and an account-scope export by an editor lists their editor gardens as excluded with
`exclusionReason: 'not_owner'` rather than guessing (`kysely-export-snapshot-reader.ts:131-132`).
The reason to start closed: an export package is the whole garden — every observation, every media
file, every collaborator's contributions — in one downloadable archive, and it is the single
highest-value target in the product. Widening it is a one-line matrix change plus tests; narrowing it
after users have the feature is not. The open product decision is already recorded in
[`deferred-capabilities.md`](deferred-capabilities.md) lines 900-903.

### 5.4 A viewer can read the Today view even though reading it writes (B2)

`GetTodayView` requires only `viewGarden` (`get-today-view.ts:153`) but transitions recommendation
candidates from `eligible` to `presented` under an advisory lock (`:210-224`). Presentation state is
bookkeeping about what the system has shown, not garden content a member authored — a viewer who
opens Today genuinely has been shown those recommendations, and recording that is not an act of
gardening. The rule stands, but the asymmetry is real and is listed as gap G-14 so it is a decision
on record rather than an accident of which capability someone typed.

### 5.5 An editor and a viewer may see the member roster, but not administer it (H2, S1)

No document answers this. Denying it would mean a household viewer cannot tell who else can see
their garden — which is a privacy answer, not a privacy protection. The roster is limited to display
name and role: email addresses are how invitations are bound and are the enumeration surface worth
protecting, so they stay owner-visible. This is the same reasoning
`UpdateNotificationPreferences` already applies when it accepts `viewGarden` for a garden-scoped
setting (`notification-preference-commands.ts:77-80`).

### 5.6 Neither an editor nor a viewer may read the collaboration audit trail (H14, S2)

Also undocumented. Audit exists to reconstruct who did what to whom, including membership removals
and role changes — which is administration, and `collaboration-and-client-sharing.md:57` puts
administration outside the editor role. A member who wants to know who changed a task can read the
task's own attribution (B17) without a trail of every membership decision an owner has made.

### 5.7 Any member may leave (H12, S3)

Removal by an owner is administration; leaving is not. Requiring an owner's action to end one's own
participation makes membership a trap, and the account-deletion path already performs exactly this
transition for a leaver whose garden is co-owned (`request-account-deletion.ts:190-201`). The single
condition is the last-owner invariant: a sole owner cannot leave, because that would strand the
garden — they transfer ownership or delete.

### 5.8 A viewer may see what was published to a client (G6, S5)

Undocumented, and the safe-looking answer (deny) is the wrong one. Publication is outbound content
about the member's own garden; a household member who cannot see what their contractor sent to a
third party has less visibility into their own garden than the third party does. Read-only, and it
grants no publisher capability (G2-G4 stay denied).

### 5.9 An editor may download raw capture artifacts; only a viewer may not (D5)

`identity-and-authorization.md:158` denies restricted raw artifacts to the viewer specifically, and
`media-storage-and-processing.md:277` repeats it as a viewer rule. Neither denies the editor, and
denying them would break an approved capture workflow: the editor who created a retained AR capture
must be able to re-inspect the source when a proposal looks wrong. Every restricted access is
audited regardless of role (`get-media-access.ts:101-110`). Future reconstruction receives no
additional permission from this rule. The narrow reading — viewer denied, others audited — is
deliberate, but it rests on a role literal rather than a capability, which is gap G-5.

### 5.10 Nobody may publish by virtue of an operational role (G2-G4)

The single most important negative in this document. An owner is not a publisher. The capability is
granted explicitly — by an `organization_admin` for an organization-backed engagement, by a garden
owner for one without (`identity-and-authorization.md:153`) — and completing a task never publishes
it. If a later package finds itself checking `role === 'owner'` to decide whether something may go
to a client, that package has gone wrong.

---

## 6. Gap list

Every capability where the code does not enforce what section 4 says. This is the work order for the
packages that follow; P9A-CAP-01 does not fix any of it.

### G-1 — No membership administration exists at all

**Rows:** H2, H3, H5-H14 (12 of the 15 membership rows; H4 is enforced by a database CHECK and H15 by membership state). **Where:** there is no invitation module, no membership
endpoint, and no route matching `/gardens/{id}/members` anywhere in
`services/api/src/modules/*/transport/`. `collaboration.invitation` is a schema skeleton with no
producer (`migrations/1784736116655_identity-and-gardens-baseline.sql:145-170`).
`MembershipRepository` (`gardens-mapping/application/membership-repository.ts:48-79`) exposes
`insertOwner` and `setState` and **no method that changes a role**. **Missing:** the whole area.
**Owner:** P9A-API-01, P9A-OWNER-01, preceded by P9A-DATA-01.

### G-2 — The last-owner invariant is stated everywhere and enforced nowhere

**Rows:** H9, H10, H12, H13. **Where:** no database constraint in any migration (grep for
`last.owner`/`one_owner` over `services/api/migrations/` returns nothing), and no domain rule.
`activeOwners` (`gardens-mapping/application/garden-membership-revocation.ts:119-125`) counts active
owners correctly but has exactly one consumer — account deletion's sole-owner branch
(`deletion/application/request-account-deletion.ts:161-163`). **Missing:** an invariant that refuses
the last demotion, the last removal, and the last self-removal, under concurrency. Two concurrent
demotions of two co-owners must not both succeed. **Owner:** P9A-DATA-01 (constraint) and
P9A-OWNER-01 (command-level check).

### G-3 — No `manageMembership` capability exists

**Rows:** H2, H3, H5-H14. **Where:** `GardenCapability`
(`gardens-mapping/domain/garden-role.ts:23-39`) has four members; membership administration is not
one. The file's own header admits it: "`manageMembership`, for example, has no endpoint yet"
(lines 4-5). **Missing:** at minimum `manageMembership`; probably also `transferOwnership` as a
separate, recent-auth-gated capability, so that "may administer members" and "may hand over the
garden" are not the same bit. **Owner:** P9A-OWNER-01.

### G-4 — Account-scope export decides garden inclusion by role literal, in persistence

**Rows:** F3. **Where:** `exports/persistence/kysely-export-snapshot-reader.ts:131-132` —
`included: membership.role === 'owner'`, `exclusionReason: membership.role === 'owner' ? null :
'not_owner'`. This is the real authorization decision about which garden data leaves the system, and
it does not call `roleHasCapability`. Line 103 hardcodes `role: 'owner'` for the garden-scope
listing on the same assumption. **Consequence:** widening `exportGarden` in
`garden-role.ts:42-44` would widen F1 and leave F3 unchanged — the two would silently disagree.
**Missing:** replace both literals with an `exportGarden` evaluation. **Owner:** whichever package
resolves the deferred editor/viewer export decision.

### G-5 — Restricted-media denial is a role literal with no capability behind it

**Rows:** D5, D9. **Where:** `media/application/get-media-access.ts:88-90` compares
`membership.role === 'viewer'` against `record.sensitivityClassification === 'restricted'`. The file
documents why (lines 10-19: the rule depends on the record, not the role, and
`GardenCapability`'s boolean matrix has no room for it) and that no "explicitly allowed" override
exists. **Consequences:** (a) the rule keys on `sensitivityClassification`, not `mediaClass`, so a
`raw_capture` classified as anything other than `restricted` is viewer-readable; (b)
`media-storage-and-processing.md:277`'s "unless explicitly allowed" has no mechanism to hang on;
(c) if a fourth role is ever added it inherits viewer's ordinary-media access and the editor's raw
access, silently. **Missing:** a `viewRestrictedMedia` capability or a per-media grant, and a test
that fails when a new role is added without a decision. **Owner:** unassigned; raise with P9A-DATA-01.

### G-6 — Garden lifecycle state is not enforced on content commands — CLOSED

**Rows:** A16, I3. **Was:** `requireMutable` (`gardens-mapping/domain/garden.ts`) was reached only
from `renameGarden` and, in a different shape, `archiveGarden`; no command in `plants-inventory`,
`tasks-recommendations`, `observations-history`, `media`, or the map-object family read
`garden.lifecycleState` at all, so the retained owner of a garden in `deletion_requested` could keep
adding plants, tasks, observations, and media throughout the 30-day window — and
`request-garden-deletion.ts` claimed the opposite in a comment.

**Fixed as this gap's own analysis proposed:** the guard is a lifecycle matrix consulted inside
`GardenAuthorization.requireCapability` (§3), so all 44 production call sites and every command
written later inherit it. `editGardenContent` is refused in `deletion_requested` and `purging` with
`422 garden.lifecycle_conflict`; `viewGarden` and `manageGarden` are not (reads must survive the
recovery window, and RESTORE holds `manageGarden`); `exportGarden` survives `deletion_requested` but
not `purging`. `requireMutable` stays, now narrowed by its own comment to the one mutation that does
not hold `editGardenContent` — rename. The false comment in `request-garden-deletion.ts` is
corrected. Coverage: `garden-authorization.test.ts` (full capability × state sweep, exhaustive over
capabilities by type), one refused mutation per module in the four modules with command unit tests,
and `tests/integration/deletion-content-freeze.test.ts` (real commands per module, reads and export
still succeeding, restore, the purge sweep, and the `rejected` sync-push classification).

**Still open, deliberately:** `UpdateNotificationPreferences` rides on `viewGarden` (row A15) and so
remains permitted during the window — it edits the caller's own settings, not garden content.

### G-7 — Garden-scope export has no recent-authentication gate

**Rows:** F1. **Where:** `exports/application/request-export.ts:78-88` — `account` scope calls
`assertRecentAuthenticationForAccountExport`, `garden` scope calls only `requireCapability`. A garden
export can carry the same media bytes as the account export that requires a fresh sign-in.
`data-export-and-deletion.md:58` names recent authentication for account-wide export only, so this
is compliant with the document as written — and the document is arguably wrong. **Missing:** either
the gate, or a written decision that a stolen long-lived session may export one garden but not all
of them. **Owner:** raise with the owner alongside S6.

### G-8 — The sync push boundary performs no capability check of its own

**Rows:** every mutation row, on the offline path. **Where:**
`synchronization/application/push-sync-operations.ts`, `sync-operation-router.ts`, and the four
`route-*-operation.ts` files contain no `requireCapability` call. Rejection is entirely inherited
from the delegated use case, and the mapper turns whatever it throws into a per-operation `rejected`
result inside an HTTP 200 batch (`sync-routes.ts:150-153`). **Consequence:** the offline path's
safety is a property of every command remembering its own check, with no defence in depth at the
boundary. A future command that forgets is writable by a viewer offline and correctly refused online.
**Missing:** a boundary assertion that every routed operation family declares a required capability,
and a test that a viewer's push of each mutation family is rejected. **Owner:** P9A-SYNC-01.

### G-9 — The sync pull partition never consults role

**Rows:** the read rows, indirectly. **Where:**
`synchronization/application/get-sync-changes.ts:220-226` splits the profile's memberships on
`state === 'active'` only; the repository projection does not even select the role column
(`kysely-membership-repository.ts:85-95`). A viewer's pull and an editor's pull of the same garden
are byte-identical. **Assessment:** correct today, because every synced record family is readable
with `viewGarden`. It is a gap because nothing pins that: the first record family that is not
viewer-readable will leak through the pull with no test failing. **Missing:** a per-record-family
capability declaration on the pull path. **Owner:** P9A-SYNC-01.

### G-10 — Authorization failures on the pull path surface as `500`

**Where:** `get-sync-changes.ts:347-365` wraps any `ApplicationError` from the per-record readers —
including a `403` — into an `InternalError`. **Consequence:** a membership revoked mid-pull produces
an internal error rather than a partition change, which is exactly the scenario
`offline-synchronization.md:130-132` says must produce a revocation change or a reset instruction.
**Owner:** P9A-SYNC-01.

### G-11 — Notification fan-out selects recipients by membership with no role filter

**Rows:** none today; B14-B16 tomorrow. **Where:**
`notifications/persistence/kysely-garden-recipient-source.ts` filters on `garden_id` plus
`state = 'active'`. A viewer receives the same garden notifications as an owner.
`application/garden-recipient-source.ts:5` and `notification-inbox-commands.ts:18` mention
`GardenAuthorization` in comments only; neither imports it. **Assessment:** acceptable while every
notification concerns content a viewer may read. It stops being acceptable the moment assignment and
membership-change notifications exist — a viewer must not be told who was promoted. **Missing:** a
per-intent audience rule. **Owner:** P9A-TASK-01.

### G-12 — No assignment or attribution model

**Rows:** B14-B17. **Where:** nothing in `tasks-recommendations` references an assignee. Actor
identity is recorded on audit and idempotency rows (`actorProfileId`) but is not a readable field on
a task. **Owner:** P9A-DATA-01, P9A-TASK-01.

### G-13 — No readable collaboration audit trail

**Rows:** H14. **Where:** `platform/audit/audit-logger.ts` has writers throughout (garden deletion,
restricted media access, export requests, account deletion) and no reader scoped to a garden.
**Owner:** P9A-DATA-01.

### G-14 — A `viewGarden` read performs a write

**Rows:** B2. **Where:** `tasks-recommendations/application/get-today-view.ts:153` authorizes with
`viewGarden`; lines 210-224 transition candidates `eligible → presented` and raise `ConflictError`
on a lost race. See §5.4 for why the row is nevertheless Allowed. **Missing:** nothing behavioural —
this is registered so the asymmetry is a recorded decision, and so that any future widening of what
Today writes is evaluated against `editGardenContent` rather than inherited. **Owner:** none;
review at P9A-TASK-01.

### G-15 — Role transitions have no concurrency control

**Rows:** H7-H9, H13. **Where:** `collaboration.membership` carries a `revision` column
(`migration:133`) that no code reads or increments; `setState` (`kysely-membership-repository.ts:120-126`)
updates unconditionally. **Consequence:** the "concurrent role-transition tests" P9A-OWNER-01's
completion evidence demands have nothing to test against yet. **Owner:** P9A-DATA-01.

### G-16 — Publication does not exist

**Rows:** G1-G8. **Where:** no `client_engagement`, no publisher capability, no publication tables,
no client routes. `media/application/get-media-access.ts:39-42` already records the deferral for
media entitlement. **Owner:** P9B and P9C.

### G-17 — Two routes accept a garden id they never authorize against

**Rows:** A8 (benign today). **Where:**
`plants-inventory/transport/plant-routes.ts:427-429` — `GET /gardens/{gardenId}/taxonomy-references`
parses `gardenId` and discards it; `SearchTaxonomyReferences.execute(query, limit)` never receives a
profile. Justified at `search-taxonomy-references.ts:4-9` (the catalog carries no `garden_id`).
Similarly `observations-history/application/get-observation.ts` performs no capability check at all;
its single caller does its own garden match (`create-manual-task.ts:89-92`). **Assessment:** neither
leaks garden data today. Both are listed because the route shape and the method name imply a scope
that is not enforced, and a later change that adds garden-scoped data to either response would
create a real hole with no test failing. **Owner:** none; a review note for P9-QA-01.

### G-18 — One exhaustive role sweep exists, for one capability

**Where:** `gardens-mapping/application/garden-authorization.test.ts:91-101` parameterises the three
roles against `manageGarden` only. `identity-and-authorization.md:355` requires "Every role/capability
combination". Individual viewer-denial tests exist across the modules
(`record-observation.test.ts:518`, `correct-observation.test.ts:464`, `add-plant.test.ts:158`,
`create-manual-task.test.ts:313`, `get-media-access.test.ts:143-189`, and others), but there is no
single test that fails when a capability is added to `ROLE_CAPABILITIES` without a decision.

The lifecycle half now has exactly that property and is the shape to copy: `garden-authorization.test.ts`'s
`EXPECTED_STATES` is a `Record<GardenCapability, …>`, so a new capability does not compile until its
lifecycle decision is recorded, and a runtime assertion pins the derived capability list against it.
The role half still has no equivalent. **Missing:** a table-driven test over the full role ×
capability product, which is the natural completion evidence for this document.
**Owner:** P9A-API-01 or P9-QA-01.

---

## 7. Change control

This matrix is the vocabulary later P9A packages test against. Changing a cell is a product decision,
not a refactor:

1. Change the row here, with the reason, in the same change as the code.
2. Change `ROLE_CAPABILITIES` (`gardens-mapping/domain/garden-role.ts:41-45`) — never a role literal
   at a call site. If a rule cannot be expressed as a capability, say so in the row and open a gap,
   as D5 does.
3. Update the role × capability test (G-18) so the new cell is asserted in both directions.
4. If the change touches an area the architecture documents cover, update
   `identity-and-authorization.md` in the same change; if it resolves one of S1-S7, remove it from
   section 2.
