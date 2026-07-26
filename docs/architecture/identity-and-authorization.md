# Identity and Authorization Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines authentication, application identity, web sessions, account lifecycle, operational garden membership, service organizations, client engagements, publication-only client access, administrative access, and security boundaries.

## 2. Identity Authority

Firebase Authentication owns:

- External sign-in credentials.
- Provider links.
- Firebase user identifier.
- ID and refresh tokens.
- Credential revocation state.

PostgreSQL owns:

- Grow Garden profile identifier.
- Mapping to Firebase user ID.
- Account lifecycle state.
- Garden memberships and roles.
- Service organizations, organization memberships, and garden assignments.
- Client engagements, client invitations, publication grants, and stewardship policy.
- Invitations.
- User preferences and consent records.
- Administrative support grants.

Firebase custom claims are not the authoritative store for garden memberships.

## 3. Initial Sign-In Methods

- Sign in with Apple.
- Google Sign-In.
- Email magic link.

Email/password, phone, Microsoft, SAML, and OIDC may be added after separate product and abuse review.

Provider linking must prevent accidental creation of duplicate application profiles. Account-linking conflicts require proof of control over both identities.

## 4. Native Authentication Flow

```text
Native app
   │
   ├── provider sign-in
   ▼
Firebase Authentication
   │
   ├── ID token
   ▼
Grow Garden API
   │
   ├── verify token and App Check
   ├── map Firebase UID to profile
   └── authorize requested garden capability
```

On iOS, "provider sign-in" means each provider's own native SDK, never Firebase's generic IDP web flow: `ASAuthorizationAppleIDProvider` for Apple, `GIDSignIn` (GoogleSignIn-iOS) for Google. Each returns an assertion that the client exchanges for a Firebase credential (`OAuthProvider.appleCredential(withIDToken:rawNonce:fullName:)`, `GoogleAuthProvider.credential(withIDToken:accessToken:)`) and signs in with. The generic flow cannot complete either on a device — it traps for Apple, and for Google it loses its own state in `SFSafariViewController`'s partitioned `sessionStorage` and ends at "Unable to process request due to missing initial state". Only the email magic link still relies on Firebase's own web handling. See `apps/ios/Sources/CoreAuthentication/AppleSignInPresenter.swift` and `GoogleSignInPresenter.swift`.

The native client refreshes credentials through the Firebase SDK. The API does not receive or store provider refresh tokens.

## 5. Web Session Flow

1. The browser signs in with a Firebase provider using no persistent long-lived browser auth state.
2. The browser submits the Firebase ID token plus CSRF proof to the session-login endpoint.
3. The server verifies the token, authentication age, account state, and anti-abuse requirements.
4. The server creates a Firebase session cookie with an approved bounded lifetime.
5. The cookie is `Secure`, `HttpOnly`, and uses an explicit `SameSite` policy.
6. Logout clears the cookie and may revoke refresh tokens for high-risk or global logout flows.

Mutation requests authenticated by cookie require CSRF protection. Session renewal requires deliberate policy rather than unlimited sliding expiration.

## 6. Application Profile Provisioning

The first authenticated API request provisions an application profile idempotently if policy allows registration.

Provisioning records:

- Grow Garden profile UUIDv7.
- Firebase UID.
- Verified provider identifiers required for support and linking.
- Creation and terms/consent versions.
- Locale and time zone defaults.
- Account status.

Provider display names and photos are treated as untrusted presentation input and are not immutable identity evidence.

## 7. Account States

```text
pending → active → deletion_requested → disabled → purged
             └──→ suspended
```

- `pending`: additional onboarding or consent is required.
- `active`: ordinary use is allowed.
- `suspended`: authentication may succeed, but application access is restricted.
- `deletion_requested`: access is disabled or limited during the recovery window.
- `disabled`: credentials and domain operations are blocked pending purge or investigation.
- `purged`: application data has been deleted according to policy.

State transitions are audited and idempotent.

### 7.1 Implemented account-state profile (P8-DELETE-01)

Every transition on the deletion arm now has a producer, and the state names carry their documented
meanings exactly:

- `active → deletion_requested` — `POST /account/deletion`, behind a 30-minute step-up gate.
  "Access is disabled or limited during the recovery window" needs no separate mechanism:
  `isAccountUsable` already answers `false` here, so every authenticated route refuses the session.
  The three account-deletion routes are deliberately registered in their own encapsulation context
  that admits this one state — the "limited" half of the definition, and the only way a recovery
  window can be acted inside.
- `deletion_requested → active` — `DELETE /account/deletion`, inside the window, same gate.
- `deletion_requested → disabled` — the deletion sweep claiming the purge. "Credentials and domain
  operations are blocked pending purge" is literally the situation; from here recovery is refused.
- `disabled → purged` — the purge completing, AFTER the Firebase identity is deleted. The row
  survives as a minimized tombstone (an unresolvable `firebase_uid`, default settings, no personal
  data) because shared-garden content this account authored still references it; see
  `data-export-and-deletion.md` section 11.1 for why deleting it is not possible.

`pending` and `suspended` still have no producer, unchanged.

## 8. Operational Garden Roles

Initial operational roles are:

### Owner

- View and edit all garden content.
- Manage membership and roles.
- Configure garden-level settings.
- Export garden data.
- Delete or transfer the garden subject to policy.

Multiple active owners are allowed. Equal household partners may both be owners.

### Editor

- View and edit garden content.
- Add media, observations, tasks, and map changes.
- Run allowed processing within quotas.
- Cannot change ownership or delete the garden.

Editors can receive and complete assignments. Client publication is a separate capability and is not implied by edit permission automatically.

For an organization-backed engagement, an `organization_admin` grants the separate client-publisher capability. For an engagement with no service organization, a garden owner grants it. No operational role receives client publication implicitly.

### Viewer

- View accepted garden content and permitted history.
- Cannot mutate domain data or access restricted raw capture artifacts.

Viewer is an internal operational role. It must not be used for professional-service clients.

The permission matrix is implemented as stable capabilities rather than scattered role-name comparisons.

### 8.1 Service Organizations

A `service_organization` represents a solo professional or small garden-care team managing one or more client gardens.

Initial organization roles are:

- `organization_admin`: manage organization members, assignments, publication policy, and organization settings.
- `professional`: work on gardens explicitly assigned through an active operational membership or garden assignment.

Organization membership alone grants no garden capability. A garden assignment references an organization member, garden, operational role/capabilities, effective dates, and state.

### 8.2 Client Engagements

A `client_engagement` links one garden, one optional service organization, and one or more client profiles. It owns:

- Engagement state and effective dates.
- Client invitation and access state.
- Data-stewardship policy.
- Notification preferences.
- Publication eligibility.
- Handoff and revocation state.

The default residential-service stewardship policy makes the accepted garden model and published deliverables client-exportable. Provider-internal notes, assignments, drafts, estimates, diagnostics, and unpublished work remain organization data.

### 8.3 Client Publication Capabilities

Client capabilities are evaluated only against an active engagement and a published resource:

- `viewPublishedGardenOverview`.
- `viewPublishedWork`.
- `viewPublishedMedia`.
- `viewPublishedTimeline`.
- `viewPublishedTimeMachineScenario`.
- `exportClientEntitledData`.

A client has no implicit capability to view internal tasks, recommendations, observations, notes, drafts, conflicts, capture proposals, raw media, processor diagnostics, or organization membership.

## 9. Authorization Evaluation

Every protected use case evaluates:

1. Authenticated application profile.
2. Account state.
3. Access plane: operational team or client publication.
4. Current garden membership and assignment, or current client engagement.
5. Required capability.
6. Resource publication state and audience.
7. Resource-specific restrictions.
8. Feature or quota policy where relevant.

Authorization occurs inside the application layer and uses current server data. Client checks improve UX but are not security boundaries.

### 9.1 Implemented garden evaluation

`GardenAuthorization.requireCapability` is the single evaluator every garden-scoped use case in
every module calls, and it answers three of the steps above in order, because each presupposes the
previous:

1. **Current garden membership** (step 4). No active membership on an existing garden is concealed
   as `garden.not_found` — a caller must not learn which garden ids exist. A membership row that
   outlived its purged garden fails here too, and identically.
2. **Required capability** (step 5), from the role matrix in `gardens-mapping/domain/garden-role.ts`
   — `forbidden`, which a member already knows applies to a garden they know exists.
3. **Resource-specific restrictions** (step 7), today the garden's own lifecycle state: a second
   matrix in the same file names the lifecycle states each capability may be exercised in, and a
   capability exercised outside them is refused with `garden.lifecycle_conflict` (HTTP 422). This is
   what freezes content in a garden pending deletion — see `data-export-and-deletion.md`
   section 10.1, step 3, for the matrix's current contents and the reasoning behind each entry.

The matrix is exhaustive over capabilities by type, so adding a capability for a future command is a
compile error until its lifecycle decision is recorded. Steps 3, 6, and 8 have no garden-scoped
producer yet; they are evaluated elsewhere or deferred (`deferred-capabilities.md`).

## 10. Invitations

Invitations use opaque, single-purpose, expiring tokens stored only as hashes.

Operational invitations contain garden, intended operational role, inviter, optional intended email, expiration, state, and acceptance actor.

The initial ordinary invitation flow grants only `editor` or `viewer`. To make an equal household partner a co-owner, an existing owner first invites that person, then promotes the accepted active member through the recent-auth ownership-administration flow. This preserves the existing invitation constraint and prevents possession of an invitation token alone from granting owner administration.

Client invitations contain engagement, intended client email, inviter organization or professional, expiration, state, and acceptance actor. The initial client portal uses an email-bound invitation and Firebase email magic link as the lowest-friction baseline. Anonymous public garden links are prohibited.

Acceptance is idempotent and handles:

- Existing membership.
- Expired or revoked invitation.
- Authenticated email mismatch where email binding is required.
- Ownership restrictions.
- Invitation type and access-plane mismatch.
- Client engagement revoked, expired, or not yet active.
- Account deletion or suspension.

Invitation URLs and tokens are excluded from logs and analytics.

## 11. Ownership Transfer

Ownership transfer requires:

- Current owner authentication.
- Recent authentication for sensitive action.
- Target active membership.
- Explicit confirmation by policy.
- An audit record.
- Idempotent role transition.

A garden must always have at least one owner unless it is in a deletion workflow.

## 12. App Check

App Check is a defense-in-depth signal for native and web clients.

Rollout stages are:

1. Integrate token generation and backend verification.
2. Monitor valid, missing, and invalid traffic.
3. Enforce on expensive and abuse-sensitive endpoints.
4. Expand enforcement after compatibility and support validation.

App Check failure does not reveal whether a garden or account exists.

A client must never let App Check decide whether a request is sent. The token
is a classification signal, not a credential: the backend hook runs in
`monitor` mode in every environment today, so `X-Firebase-AppCheck` is optional
on every route and a request carrying no token at all is answered normally. A
client that cannot obtain a token therefore omits the header, records the fact
as a diagnostic, and sends the request anyway.

This is a rule learned from a live defect rather than a precaution. The iOS
transport used to treat token acquisition as mandatory. `verdery-dev` has never
had `firebaseappcheck.googleapis.com` enabled, so the SDK's attestation
exchange could never succeed and always threw — which meant that in the shipped
TestFlight build every authenticated request died before it was sent. Nothing
reached the API (`verdery-api-dev`'s request log contains no iOS user agent at
all), no transport error was raised, and the escaping error surfaced to readers
as `error.server.unexpected` — a server-side apology for a server that had
never been asked anything.

Enabling App Check for a project is therefore a prerequisite of rollout stage 3
(enforcement), not of stage 1: no client may depend on it before then.

## 13. Administrative and Support Access

Support access is not represented as an ordinary garden role. It requires:

- Approved staff identity through Google Cloud IAM or an application administrative identity.
- Ticket or reason reference.
- Time-limited grant.
- Least required capability.
- Prominent audit record.
- User notification where policy requires it.
- Prohibition on raw media access unless explicitly approved.

Impersonation is avoided. If a support view is required, it is read-only by default and visually distinct.

## 14. Token and Session Revocation

Revocation is triggered by:

- Password or provider security changes where reported by Firebase.
- User global logout.
- Account suspension or deletion request.
- Confirmed credential compromise.
- Administrative security action.

High-risk endpoints verify recent authentication and, where necessary, current revocation state rather than relying only on token signature and expiration.

## 15. Account Deletion

The baseline process is:

1. Require recent authentication.
2. Record deletion request and effective recovery deadline.
3. Disable ordinary access.
4. Resolve sole-owned shared gardens through transfer or deletion policy.
5. Revoke Firebase sessions and tokens.
6. After the 30-day recovery window, run idempotent asynchronous purge.
7. Delete Firebase identity after application policy checks.
8. Record non-sensitive completion evidence required for operations or law.

Immediate irreversible deletion may be offered where safely supported. Legal holds require a separate authorized process.

## 16. Multi-Tenancy

Initial consumer gardens use one Firebase tenant and application-level garden isolation. Google Cloud Identity Platform multi-tenancy is not enabled initially.

Service organizations are application-domain tenants inside the same Firebase tenant. They use PostgreSQL organization membership, garden assignment, engagement, and capability records. This does not weaken garden-level isolation and does not store permissions in Firebase custom claims.

Enterprise identity tenants require a future ADR covering user silos, cross-tenant collaboration, provider configuration, billing, and support access.

## 17. Security Logging

Audit events include:

- Provider link and unlink.
- Session revocation.
- Role and membership changes.
- Organization membership and garden assignment changes.
- Client engagement, invitation, publication, withdrawal, handoff, and revocation.
- Invitation creation, revocation, and acceptance.
- Ownership transfer.
- Support access activation.
- Account suspension and deletion.

Audit records avoid raw tokens, magic links, and unnecessary provider payloads.

## 18. Testing

- Authentication success and expiration.
- Provider-link conflicts.
- Session-cookie CSRF behavior.
- Revocation and recent-authentication enforcement.
- Every role/capability combination.
- Membership removed between authentication and mutation.
- Organization member without a garden assignment.
- Client engagement active but requested resource unpublished.
- Client from one engagement requesting another client's publication or media.
- Withdrawn publication and revoked engagement.
- Operational viewer denied client-publisher capability.
- Invitation replay and expiry.
- Last-owner invariants.
- Deletion and recovery-window transitions.
- Support grant expiry.
- Cross-garden and concealed-existence attacks.

## 19. Completion Criteria

- Credentials remain in Firebase while application permissions remain in PostgreSQL.
- Native and web sessions use approved separate flows.
- Every protected use case checks a capability.
- Membership changes invalidate subsequent access immediately at the server.
- Organization membership never grants garden access without assignment or operational membership.
- Client access resolves only through an active engagement and immutable published resources.
- A client cannot enumerate or retrieve provider-internal records through client endpoints.
- Invitations and support access are expiring and audited.
- Account deletion reaches identity, domain data, media, and local-device policy.
