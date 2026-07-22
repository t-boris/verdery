# Collaboration and Client Sharing Design

> Status: Draft 0.1
> Decision status: Approved baseline
> Last updated: July 22, 2026

## 1. Purpose

This document defines the end-to-end design for sharing a garden with household members, colleagues, garden-care professionals, and professional-service clients. It consolidates the domain boundaries, workflows, capabilities, data ownership, API surfaces, synchronization behavior, portal behavior, security controls, and release evidence required by ADR-0012.

Component-specific details remain authoritative in the identity, data, API, backend, web, native, media, notifications, synchronization, security, testing, and export designs.

## 2. Core Boundary

Grow Garden has two sharing planes with different purposes and trust levels.

| Plane              | Participants                                              | Data surface                                                                                         | Mutation model                                     |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Operational garden | Owners, editors, internal viewers, assigned professionals | Live accepted garden plus role-permitted operational work, history, media, and synchronization state | Owners and editors perform role-permitted commands |
| Client publication | Clients connected through an active engagement            | Immutable published result projection only                                                           | Read-only in the initial portal release            |

A client is never implemented as an operational viewer. Client isolation is enforced by separate resources, capabilities, repository queries, endpoints, media entitlements, and tests. Hiding operational controls in the browser is not an authorization boundary.

## 3. Domain Relationships

```text
profile
  │
  ├── garden_membership ───────────────► garden
  │       owner | editor | viewer          │
  │                                        │
  ├── organization_membership              ├── task / observation / media
  │       admin | professional             ├── work_log
  │                 │                      └── accepted garden revisions
  │                 └── garden_assignment ─┘
  │
  └── client_access_grant
             │
             ▼
      client_engagement ────────────────► garden
             │
             └── client_publication ────► selected safe snapshots/media
```

The application database, not Firebase custom claims or Identity Platform tenancy, owns every relationship in this diagram.

## 4. Operational Roles and Capabilities

### 4.1 Owner

An owner can view and edit the live garden, perform ordinary garden work, manage members, promote or demote co-owners subject to the last-owner invariant, configure garden settings, export owned data, and initiate deletion.

Multiple owners are allowed. This supports equal household administration without inventing a special spouse role.

### 4.2 Editor

An editor can view and edit accepted garden content, receive and complete assignments, add observations and media, and perform allowed processing. Editor does not imply membership administration, destructive garden administration, export ownership, or client publication.

### 4.3 Viewer

A viewer is an internal read-only participant who may see accepted garden content and explicitly permitted operational history. Viewer is not a client role.

### 4.4 Publisher

Client publishing is a separate capability. An organization administrator grants it explicitly for an organization-backed engagement. For an engagement with no service organization, a garden owner grants it. Owner, editor, or professional status alone does not imply publisher access.

The capability vocabulary is stable even if later product policy maps roles to capabilities differently.

## 5. Operational Invitation and Co-Ownership

Operational invitations use opaque, single-purpose tokens stored only as hashes. An invitation records garden, inviter, intended email when bound, intended role, expiration, state, and acceptance actor.

The initial ordinary invitation grants `editor` or `viewer` only:

```text
pending ──accept──► accepted
   │
   ├──revoke─────► revoked
   └──time───────► expired
```

Acceptance requires authentication and, for an email-bound invitation, a normalized verified-email match. It is idempotent and cannot reveal whether an unrelated garden exists.

To establish equal household ownership:

1. An owner invites the person as an editor.
2. The person authenticates and accepts.
3. The owner performs a recent-auth sensitive action to promote the active member to owner.
4. The server checks the current revision and records an audit event.

Removing or demoting an owner must never leave an active garden without at least one owner.

## 6. Tasks, Work, and Attribution

A task is planned operational intent. A work log is an immutable or append-oriented fact about work that occurred. A client publication is an external presentation of selected facts. They are related but not interchangeable.

Every material operational action records:

- Actor profile.
- Effective organization or assignment when relevant.
- Garden and affected resource.
- Server time and client-reported occurrence time where useful.
- Source command or operation identifier.
- Previous and resulting revision or state.

Concurrent task assignment and completion use explicit commands and domain rules. Generic last-write-wins behavior must not silently replace another participant's work.

## 7. Service Organizations and Assignments

A `service_organization` represents a solo professional or small garden-care team. Initial roles are:

- `organization_admin`: organization membership, garden assignments, publisher grants, and organization policy.
- `professional`: ordinary work on explicitly assigned gardens.

Organization membership alone grants no garden access. Access requires a current garden assignment or direct operational garden membership. Every assignment has effective dates, state, role or capabilities, creator, and audit history.

A solo professional may start with an organization containing one administrator. This keeps the domain model consistent when the business later adds a second worker.

## 8. Client Engagement

A `client_engagement` links one garden, an optional service organization, and one or more client profiles. It owns:

- Engagement state and effective dates.
- Client invitation and access state.
- Publisher eligibility and notification preferences.
- Data-stewardship policy.
- End-of-engagement handoff and revocation state.

Recommended states are:

```text
draft ──activate──► active ──end──► ended
  │                    │
  └──cancel────────────┴─────────► revoked
```

Activation requires at least one garden, one client identity or pending bound invitation, and an approved stewardship policy. An ended or revoked engagement cannot authorize new portal or media access.

## 9. Client Invitation and Session

The initial client journey is:

1. An authorized professional creates an email-bound invitation for an engagement.
2. Transactional email delivers an opaque, expiring link without sensitive garden content.
3. The client signs in through Firebase, with email magic link as the lowest-friction default.
4. The API verifies invitation state, verified email, account state, engagement state, and replay/idempotency conditions.
5. Acceptance creates or activates a client access grant.
6. The web session queries only client-portal endpoints.

Anonymous public links are excluded. Invitation tokens, magic links, and session material are prohibited in logs and analytics.

## 10. Publication Workflow

Completing a task does not publish it automatically. An authorized publisher creates and reviews a client-safe update.

```text
internal_draft
      │ submit
      ▼
ready_for_client
      │ publish
      ▼
published ──withdraw──► withdrawn
```

Publishing is a revision-guarded, idempotent transaction that:

1. Revalidates publisher, organization, assignment, engagement, garden, and media capabilities.
2. Validates that every selected item is client-safe and belongs to the engagement's garden.
3. Creates an immutable publication version and item snapshots.
4. Creates explicit media-entitlement records.
5. Appends audit and outbox records atomically.
6. Schedules a notification only after commit.

Withdrawal removes a publication from ordinary client queries and revokes its media entitlements. It does not erase the publication identity or security audit trail.

## 11. Publication Contents

A publication version may contain:

- Client-safe title and result summary.
- Selected completed-work snapshots.
- Selected before/after media derivatives.
- Accepted garden overview or snapshot.
- Factual timeline entries.
- Staff display attribution explicitly selected for publication.
- A future Time Machine scenario only when that separate artifact has been explicitly published.

It must not contain internal tasks, assignments, notes, estimates, recommendations, unaccepted geometry, drafts, synchronization conflicts, capture proposals, raw scans, processor diagnostics, or unpublished media.

Snapshots preserve what the client saw at publication time. A later operational edit cannot silently rewrite an older publication.

## 12. Garden Timeline and Time Machine

The two time-based views have different truth claims.

### 12.1 Garden Timeline

Garden Timeline is factual. It is composed from immutable published updates, completed-work snapshots, selected media, and accepted garden snapshots with real timestamps. It may ship with the first client portal.

### 12.2 Future Time Machine

Future Time Machine is illustrative. It depends on P14 and retains horizon, assumptions, uncertainty, source/model versions, and non-prediction disclosure. A scenario is client-visible only after explicit publication.

The portal must never interpolate an invented historical state or present a future scenario as a factual outcome.

## 13. API Surfaces

Representative route groups are:

```text
# Operational garden
/v1/gardens/{gardenId}/invitations
/v1/gardens/{gardenId}/members
/v1/gardens/{gardenId}/assignments
/v1/gardens/{gardenId}/activity

# Professional workspace
/v1/service-organizations
/v1/service-organizations/{organizationId}/members
/v1/service-organizations/{organizationId}/garden-assignments
/v1/client-engagements
/v1/client-engagements/{engagementId}/updates
/v1/client-engagements/{engagementId}/publications

# Client portal
/v1/client/gardens
/v1/client/gardens/{clientGardenId}/overview
/v1/client/gardens/{clientGardenId}/publications
/v1/client/gardens/{clientGardenId}/timeline
/v1/client/publications/{publicationId}/media/{mediaId}/access
/v1/client/gardens/{clientGardenId}/exports
```

Operational identifiers are not accepted as authority by client routes. A client-facing garden handle may map internally to an engagement and garden, but authorization always starts from the current client profile and active access grant.

All mutations define idempotency, optimistic concurrency, audit behavior, and intentionally concealed not-found behavior.

## 14. Web and Native Surfaces

The operational web and native applications support household/team participation. The web application is the preferred initial administration surface for organizations, engagements, and publication preparation.

The client portal is a responsive route group in the existing web deployment with its own layout, navigation, gateways, queries, analytics allowlist, and tests. It is deliberately read-only in the initial release.

A native client portal is deferred. If added, it uses a separate publication-only read model and never reuses the operational garden synchronization partition.

## 15. Synchronization and Revocation

Operational members and assigned professionals use the ordinary authorized garden partition. Membership and assignment changes affect the next server operation.

When operational access is revoked:

- New commands are denied immediately from current server state.
- Pending operations become rejected under stale authorization.
- The native client receives a revocation/reset instruction.
- Protected local garden data is removed according to recovery policy.

Client sessions are online-first. Engagement revocation or publication withdrawal affects the next portal or media authorization. Client publications are not inserted into the operational mutation outbox.

## 16. Media Access

Media association with a garden is insufficient for client access. Client media authorization requires all of:

- Authenticated client profile.
- Active account and engagement.
- Active client access grant.
- Visible publication version.
- Explicit publication-media entitlement.
- Requested safe derivative or specifically entitled original.

Access uses short-lived authorization. State is rechecked before issuing access so revocation and withdrawal do not wait for an old application cache.

## 17. Notifications

Durable notification intents cover:

- Operational invitation and acceptance.
- Task assignment or reassignment.
- Client invitation.
- Client publication.
- Material publication withdrawal or engagement change when policy requires notice.

Workers recheck recipient access, current state, preferences, deduplication key, and freshness before delivery. A notification preview contains no sensitive notes, addresses, or media.

## 18. Data Stewardship, Export, and Engagement End

The default residential-service policy makes the accepted garden model and published deliverables client-exportable. It excludes provider-internal notes, assignments, estimates, recommendations, drafts, diagnostics, raw captures, and unpublished work.

Ending an engagement:

1. Stops new client publication and access according to policy.
2. Produces or offers the entitled export/handoff package.
3. Revokes portal and media access after the configured handoff window.
4. Preserves provider records required for audit, dispute, legal, or retention obligations.
5. Records completion evidence without claiming that backups were synchronously erased.

Supporting a materially different contractual stewardship policy requires explicit product and legal approval.

## 19. Audit and Observability

Audit events include invitation lifecycle, membership and ownership change, organization assignment, engagement lifecycle, publisher grant, publication, withdrawal, portal access to sensitive media, export, and revocation.

Product and operational metrics may include:

- Invitation acceptance and expiry rates.
- Active shared gardens and assignment completion.
- Time from work completion to publication.
- Publication correction or withdrawal rate.
- Portal open and return rate.
- Authorization denial counts by safe reason category.
- Engagement handoff/export completion.

Telemetry excludes invitation tokens, client email, garden geometry, addresses, notes, publication text, media URLs, and raw resource identifiers where a pseudonymous aggregate is sufficient.

## 20. Failure and Concurrency Behavior

| Failure                           | Required behavior                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Invitation replay                 | Return the existing accepted result to the same eligible actor or a safe terminal error |
| Email mismatch                    | Deny without revealing unrelated account or garden details                              |
| Last-owner removal                | Reject atomically                                                                       |
| Concurrent assignment             | Apply explicit revision/state rules and retain attribution                              |
| Publication request retried       | Return the same immutable publication version for the same idempotency key and payload  |
| Source item changes during review | Fail the revision guard and require publisher re-review                                 |
| Media withdrawn after page load   | Deny the next access authorization                                                      |
| Engagement revoked during session | Deny the next query and clear portal state safely                                       |
| Notification provider unavailable | Keep durable intent, retry with backoff, and never roll back the committed publication  |
| Export partially fails            | Resume idempotently and expose status without leaking internal records                  |

## 21. Migration and Rollout

Use additive migrations and independent feature flags:

1. Ship capability vocabulary and operational membership invariants.
2. Release P9A invitation, co-owner, assignment, attribution, and sync behavior to a small household/team cohort.
3. Add organization and engagement tables without granting access from organization membership.
4. Add publication tables and publisher preview before any client route is enabled.
5. Validate client endpoints and media isolation with synthetic engagements.
6. Enable client invitations and portal for a small professional/client cohort.
7. Add factual Garden Timeline.
8. Enable future Time Machine publication only after P14 passes its separate gate.

Existing garden memberships remain valid. No backfill converts viewers into clients. A professional/client relationship is created only through an explicit engagement.

## 22. Test Matrix

Required actor classes are:

- Owner and co-owner.
- Editor.
- Internal viewer.
- Organization administrator with and without garden assignment.
- Professional with active, future, expired, and revoked assignment.
- Publisher and operational member without publisher capability.
- Invited client before and after acceptance.
- Active, ended, and revoked client.
- Client from another engagement.
- Non-member, suspended account, support grant, and system worker.

Every resource type must have positive and negative tests across garden, organization, engagement, publication state, and media entitlement. End-to-end scenarios cover household invitation/co-ownership, team assignment/completion, professional publication, client portal viewing, withdrawal, revocation, and engagement handoff.

## 23. Open Product Decisions

Architecture remains stable while these product decisions are validated:

- Which organization roles may receive publisher capability by default.
- Whether the first mutation added to the client portal is acknowledgement, approval, or a structured change request.
- Which staff identity and attribution fields clients should see.
- Whether any low-risk work categories may opt into reviewed automatic publication later.
- Which stewardship policies beyond the residential default have demonstrated contractual demand.

## 24. Completion Criteria

This design is implemented when:

- Household partners can share full operational responsibility, including safe co-ownership.
- Editors can receive and complete work with durable attribution and conflict recovery.
- Organization membership never grants garden access without an assignment or membership.
- A professional can create an engagement, prepare an update, preview exactly what a client will see, and publish an immutable version.
- A client can accept a secure invitation and see only published results, completed-work snapshots, selected media, and entitled time-based views.
- Internal resources cannot be enumerated through client routes, exports, media access, errors, logs, or analytics.
- Completion, publication, withdrawal, revocation, and engagement-end behavior are idempotent and audited.
- Operational synchronization and client publication access remain separate.
- The factual Garden Timeline works without future Time Machine, and future scenarios require explicit publication.
- Cross-plane, cross-garden, cross-organization, cross-engagement, and cross-client negative tests pass.

## 25. Related Decisions and Designs

- [ADR-0012](decisions/ADR-0012-separate-team-and-client-sharing.md)
- [Identity and authorization](identity-and-authorization.md)
- [Data and geospatial model](data-and-geospatial-design.md)
- [Backend modular monolith](backend-modular-monolith.md)
- [REST API and contracts](api-design.md)
- [Web application](web-application-design.md)
- [Native Apple application](ios-application-design.md)
- [Offline synchronization](offline-synchronization.md)
- [Media storage and processing](media-storage-and-processing.md)
- [Notifications](notifications.md)
- [Security and privacy](security-and-privacy.md)
- [Data export and deletion](data-export-and-deletion.md)
- [Testing strategy](testing-strategy.md)
