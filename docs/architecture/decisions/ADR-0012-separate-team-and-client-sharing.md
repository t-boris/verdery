# ADR-0012: Separate Operational Team Access from Client Publications

> Status: Accepted
> Date: July 22, 2026

## Context

Grow Garden must support two materially different sharing relationships:

1. Household members, colleagues, and garden-care workers collaborate on the live operational garden. They may see working data, receive assignments, complete tasks, add observations, and edit accepted garden content according to their role.
2. A professional-service client sees only approved results, published completed work, selected media, an actual historical garden timeline, and explicitly published future Time Machine scenarios.

The existing owner/editor/viewer garden-role model is suitable for operational collaboration. Treating a client as another viewer would make every future internal resource depend on scattered exclusion checks and could expose internal tasks, recommendations, notes, drafts, capture proposals, synchronization conflicts, or raw media accidentally.

Professional delivery also needs a lightweight service-team boundary. This is an application domain concept, not an enterprise Firebase or Google Cloud identity tenant.

## Decision

### Operational Access

Keep direct `garden_membership` for operational collaborators:

- `owner`: full garden access plus membership, ownership, export, and deletion administration.
- `editor`: full day-to-day garden content, task, observation, media, recommendation, and map work without destructive ownership administration.
- `viewer`: internal read-only access to accepted garden content and permitted operational history.

Multiple owners are allowed. A household pair may both be owners; a colleague or worker normally receives editor access.

The initial ordinary invitation grants `editor` or `viewer`. Co-ownership is established only after invitation acceptance, through a recent-auth owner-administration action that promotes an active member. This matches the existing invitation schema and prevents an invitation token from directly granting owner administration.

### Service Organizations

Add an application-owned `service_organization` with organization memberships. The initial organization roles are `organization_admin` and `professional`.

Organization membership alone grants no garden access. A professional must also have an active garden assignment or operational garden membership. Firebase custom claims and Identity Platform tenants do not store organization or garden permissions.

### Client Engagement

Represent the service relationship through a `client_engagement` linking:

- One garden.
- One optional service organization.
- One or more client profiles.
- Engagement state and effective dates.
- A data-stewardship policy.
- Client notification and presentation preferences.

The default residential-service policy makes the accepted garden model and published deliverables client-exportable. Provider-internal notes, unaccepted drafts, assignments, operational diagnostics, estimates, and unpublished work remain service-organization data. A different contractual policy requires explicit product and legal approval rather than an undocumented flag.

### Client Access

A client is not an operational garden viewer. The client receives only capabilities over a publication projection:

- View published garden overview or snapshot.
- View published completed-work entries.
- View media explicitly included in a publication.
- View the actual historical publication timeline.
- View a future Time Machine scenario only after that scenario is explicitly published.
- Export client-entitled accepted garden data and published deliverables according to the engagement policy.

The initial client experience is a responsive route group in the existing web application. A client accepts an email-bound, expiring invitation and signs in with an approved Firebase method, with email magic link as the lowest-friction default. Anonymous public garden links are not part of the baseline.

### Publication Boundary

Internal task completion creates or updates an operational work log. It does not expose content to a client automatically.

An authorized publisher prepares a `client_update`, selects client-safe text and media, and publishes an immutable version. Publication captures stable references and safe snapshots so later internal edits do not silently rewrite what the client previously saw. A publication may be withdrawn from ordinary view, but the withdrawal is audited.

Publisher access is a separate capability. An organization administrator grants it for an organization-backed engagement; a garden owner grants it when no service organization is attached. Owner, editor, or professional status alone does not grant publication access.

Visibility states are:

```text
internal_draft → ready_for_client → published → withdrawn
```

Automatic publication may be introduced later per approved work type and organization policy, but explicit review is the default.

### Time-Based Views

Implement two distinct client concepts:

- **Garden Timeline:** factual past states composed from immutable published updates and accepted garden snapshots. This may ship with the client portal.
- **Future Time Machine:** an illustrative projection with assumptions, horizon, confidence, source/model versions, and non-prediction disclosure. Only explicitly published scenarios are client-visible and this remains dependent on the future Time Machine capability.

### Synchronization

Operational members use the normal authorized garden synchronization partition. The client web portal is online-first and queries only client publication endpoints. It does not receive or synchronize the full garden partition.

If a native client portal is added later, it must use a separate publication-only read model rather than reuse operational garden sync records.

## Consequences

- Client isolation is enforced by separate resources and query paths, not only UI filtering.
- Household and professional team collaboration continue to use one operational model.
- A small professional team can manage multiple client gardens without introducing enterprise identity tenancy.
- Publishing adds workflow, audit, snapshot, media-entitlement, withdrawal, export, and retention complexity.
- Completed tasks and client-visible completed work are related but different records with different audiences.
- Historical client timeline value can ship before predictive Time Machine rendering.
- The web application gains a client portal route group but the domain API remains the only backend.
- Existing owner/editor/viewer database values remain valid; new tables and capabilities arrive through additive migrations.

## Rejected Alternatives

- **Use `viewer` for clients:** rejected because it grants a broad live-garden read surface and makes internal-resource secrecy fragile.
- **Make every record carry one generic visibility flag:** rejected because row-level flags alone do not create stable published history, safe text/media selection, or a clear authorization boundary.
- **Create a separate client application and backend:** rejected initially because it would duplicate identity, contracts, deployment, and garden meaning.
- **Use public bearer links:** rejected because gardens, property media, work history, and location are private and access must be revocable and attributable.
- **Publish every completed task automatically:** rejected as the default because internal notes or media may require review and completed operational work is not always a client deliverable.
