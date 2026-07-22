# Identity and Authorization Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines authentication, application identity, web sessions, account lifecycle, garden membership, owner/editor/viewer authorization, administrative access, and security boundaries.

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

## 8. Garden Roles

Initial roles are:

### Owner

- View and edit all garden content.
- Manage membership and roles.
- Configure garden-level settings.
- Export garden data.
- Delete or transfer the garden subject to policy.

### Editor

- View and edit garden content.
- Add media, observations, tasks, and map changes.
- Run allowed processing within quotas.
- Cannot change ownership or delete the garden.

### Viewer

- View accepted garden content and permitted history.
- Cannot mutate domain data or access restricted raw capture artifacts.

The permission matrix is implemented as stable capabilities rather than scattered role-name comparisons.

## 9. Authorization Evaluation

Every protected use case evaluates:

1. Authenticated application profile.
2. Account state.
3. Current garden membership.
4. Required capability.
5. Resource-specific restrictions.
6. Feature or quota policy where relevant.

Authorization occurs inside the application layer and uses current server data. Client checks improve UX but are not security boundaries.

## 10. Invitations

Invitations use opaque, single-purpose, expiring tokens stored only as hashes. Invitation records contain garden, intended role, inviter, optional intended email, expiration, state, and acceptance actor.

Acceptance is idempotent and handles:

- Existing membership.
- Expired or revoked invitation.
- Authenticated email mismatch where email binding is required.
- Ownership restrictions.
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

Enterprise identity tenants require a future ADR covering user silos, cross-tenant collaboration, provider configuration, billing, and support access.

## 17. Security Logging

Audit events include:

- Provider link and unlink.
- Session revocation.
- Role and membership changes.
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
- Invitations and support access are expiring and audited.
- Account deletion reaches identity, domain data, media, and local-device policy.
