# Security and Privacy Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the security and privacy architecture for identities, clients, APIs, databases, media, workers, cloud infrastructure, providers, support access, incident response, retention, and deletion.

## 2. Security Objectives

- Prevent unauthorized cross-garden and cross-account access.
- Protect property plans, precise locations, photos, videos, and capture artifacts.
- Preserve integrity of accepted garden geometry and history.
- Limit abuse of expensive media and AI processing.
- Minimize secrets and long-lived credentials.
- Provide auditable administrative access.
- Detect and contain compromise.
- Honor deletion, retention, consent, and export commitments.

## 3. Data Classification

### Public

Approved public marketing and documentation content.

### Internal

Non-sensitive operational configuration, schemas, and aggregate service metrics.

### Confidential User Data

Garden records, plants, observations, tasks, recommendations, user profile, and collaboration records.

### Sensitive User Data

Precise address/location, property plan, original media, raw Garden Scan video, depth data, private neighboring-property imagery, invitation tokens, and detailed support records.

### Secrets

Authentication tokens, session cookies, FCM device tokens, provider credentials, signing material, resumable upload URLs, and service-account credentials.

Controls are selected by the highest classification in a payload or resource.

## 4. Trust Boundaries

```text
untrusted device/browser
        │
        ▼
Firebase Auth + App Check
        │
        ▼
HTTPS Load Balancer / Cloud Armor
        │
        ▼
Cloud Run application boundary
        │
        ├── private Cloud SQL
        ├── private Cloud Storage authorization
        ├── authenticated queues/jobs
        └── reviewed external providers
```

Client validation, device claims, local revisions, and provider callbacks are untrusted until verified by the server.

## 5. Authentication Controls

- Firebase Authentication is the credential authority.
- Native clients use Firebase ID tokens.
- Web uses secure HTTP-only Firebase session cookies with CSRF protection.
- Sensitive actions require recent authentication.
- Session and refresh-token revocation is available for compromise, suspension, and deletion.
- Provider linking requires proof of both accounts.
- Authentication errors do not reveal registered email state beyond approved Firebase behavior.

## 6. Authorization Controls

- Application authorization is capability-based and server-enforced.
- Garden membership and role come from PostgreSQL.
- Every request resolves current membership.
- Background jobs carry resource references and execute under service identity, then revalidate ownership and expected state.
- Media access is authorized by stable media ID before short-lived download access is issued.
- Administrative access is separate from ordinary garden roles.

Cross-garden isolation tests are mandatory for every new resource type.

## 7. App Check and Abuse Protection

App Check rollout is monitor-first and progressively enforced. It is mandatory for expensive upload-session, scan, AI, and abuse-sensitive endpoints after compatibility validation.

Additional controls include:

- Cloud Armor rate and threat rules.
- Application rate limits by profile, installation, garden, and operation class.
- File size, duration, type, and storage quotas.
- Processing concurrency and daily allowance.
- Idempotency to prevent replayed billing effects.
- Anomaly alerts and administrative suspension.

App Check is not authorization and can never grant data access.

## 8. API Security

- TLS only.
- Exact production CORS origins.
- CSRF protection for cookie-authenticated mutations.
- OpenAPI structural validation.
- Bounded request bodies and pagination.
- Parameterized SQL.
- Stable sanitized errors.
- Content Security Policy for web.
- No arbitrary URL fetches without SSRF protection.
- No direct database or bucket credentials delivered to clients.

## 9. Web Security

- Session cookies use `Secure`, `HttpOnly`, and approved `SameSite` settings.
- Authentication exchange validates CSRF state and recent token issuance.
- User content renders as text or through an approved sanitizer.
- Third-party scripts are minimized and reviewed.
- CSP begins in report-only mode, then is enforced.
- Secrets remain server-only and never use public build variables.
- Signed media URLs are short-lived and excluded from referrers where possible.
- Dependency and supply-chain scanning run in CI.

## 10. Native Client Security

- Keychain protects authentication-related secrets.
- Files use appropriate iOS data protection.
- Local profile databases are separated and removed according to sign-out/deletion policy.
- Debug logging is disabled or redacted in production.
- Certificate pinning is not used initially because operational risk outweighs benefit; standard platform trust and TLS are used.
- App Attest or approved App Check provider supports app integrity signals.
- Jailbreak detection is not treated as a reliable security boundary.

## 11. Database Security

- Cloud SQL uses private IP in staging and production.
- Runtime and migration database roles are separate.
- Runtime cannot create or alter schema.
- Workers receive only required permissions.
- Connection credentials or IAM database authentication are managed through Secret Manager and workload identity as supported.
- Query logging excludes sensitive bind values.
- Backups inherit controlled project access and retention.
- Production access requires audited privileged workflow.

## 12. Cloud Storage Security

- Public access prevention.
- Uniform bucket-level access.
- Separate buckets by environment and sensitivity where documented.
- Short-lived single-purpose upload/download authorization.
- Object keys contain no personal data.
- Unverified uploads remain inaccessible to ordinary consumers.
- Worker identities have input/output-specific access.
- Lifecycle and deletion rules are reviewed against user policy.

## 13. Service Identities

Each deployment unit has a dedicated Google Cloud service account:

- Interactive API.
- Outbox relay.
- Notification worker.
- Media verifier.
- Scan job.
- Export/deletion job.
- CI deployment identity.

Broad default compute identities are not used. IAM roles are resource-scoped and reviewed through Terraform.

## 14. Secrets

- Secret Manager is the authoritative secret store.
- GitHub Actions uses workload identity federation, not downloaded service-account keys.
- Secrets are versioned and rotatable.
- Applications fail safely when a required secret is absent.
- Secrets are cached in process only for approved lifetime and never logged.
- Local development uses non-production credentials and documented secure setup.

## 15. Encryption

Google-managed encryption at rest is the baseline. Customer-managed keys are introduced only for a legal, contractual, or risk requirement because they add availability and recovery obligations.

Application-level field encryption is reserved for a demonstrated requirement where ordinary database authorization and encryption are insufficient.

## 16. Untrusted Content Processing

PDF, image, video, and archive parsing occurs in constrained workers:

- Minimal service identity.
- No unnecessary network egress.
- CPU, memory, disk, and time limits.
- Patched container images.
- Input size and format validation.
- No shell construction from filenames or metadata.
- Outputs written only to dedicated object prefixes.

## 17. External Provider Security

- Send the minimum required user data.
- Review provider subprocessors, retention, and model-training terms.
- Store credentials in Secret Manager.
- Enforce strict outbound timeouts.
- Verify webhook signatures and replay windows.
- Treat provider responses as untrusted input.
- Document cross-region or cross-border transfers.

## 18. Privacy Controls

- Permissions are requested in context.
- Capture clearly explains remote processing and raw retention.
- Precise location collection is optional unless a feature requires it.
- Analytics uses consent and data minimization.
- Training use of user content requires separate explicit consent and governance.
- Support access is time-limited and audited.
- Export and deletion are available through application workflows.
- Nearby private property in capture is treated as sensitive, not incidental public data.

## 19. Retention Baseline

| Data | Baseline |
|---|---|
| Ordinary garden records and photos | Until user/garden deletion |
| Raw successful Garden Scan media | 30 days after successful extraction |
| Failed capture recovery media | Limited operational recovery period |
| Export packages | Short-lived automatic expiration |
| Security audit records | Policy-defined limited retention |
| Operational logs | Shortest useful diagnostic retention |
| Deleted account recovery | 30 days before purge by default |

Exact legal and operational periods are recorded in a retention schedule before launch.

## 20. Deletion

Deletion workflows cover:

- Firebase identity and sessions.
- PostgreSQL domain records and tombstones after sync obligations.
- Cloud Storage originals and derivatives.
- Pending jobs and exports.
- Search projections and caches.
- Provider-side data where contract/API permits.
- Local client data after next authenticated or revocation interaction.

Deletion is idempotent, observable, and produces non-sensitive completion evidence.

## 21. Security Audit Events

Audit:

- Authentication provider changes.
- Membership, role, and ownership changes.
- Support access.
- Export and deletion requests.
- Sensitive raw-media access.
- Administrative repair operations.
- Security suspension and token revocation.

Audit access is itself audited.

## 22. Logging Rules

Never log:

- Tokens, cookies, secrets, magic links, or FCM tokens.
- Signed upload/download URLs.
- Raw notes or prompts by default.
- Exact garden geometry or precise address.
- Raw provider payload containing user data.
- Media content.

Use stable IDs, classification, outcome code, and correlation ID.

## 23. Vulnerability Management

- Automated dependency scanning.
- Container image vulnerability scanning.
- Secret scanning.
- Static analysis and linting.
- Patch policy for base images and runtimes.
- Regular access and IAM review.
- Threat-model review for new major capabilities.
- Independent penetration testing before material public scale or enterprise commitments.

## 24. Incident Response

The incident process defines:

- Detection and severity.
- On-call ownership.
- Containment and credential revocation.
- Preservation of required evidence.
- User and regulatory notification assessment.
- Recovery and validation.
- Post-incident review and tracked corrective actions.

Runbooks cover identity compromise, cross-garden access defect, exposed signed URL, malicious upload, leaked provider secret, and destructive database operation.

## 25. Threat-Model Review Areas

- Broken object-level authorization.
- Invitation and ownership-transfer replay.
- Offline command replay and stale authorization.
- SSRF through imported URLs or providers.
- Malicious PDF/video/image parser input.
- Prompt injection and tool abuse.
- Signed URL leakage.
- Cloud Run/Cloud SQL privilege escalation.
- Supply-chain dependency compromise.
- Cost-exhaustion attacks.
- Support access misuse.

## 26. Testing

- Authorization matrix and cross-garden attacks.
- CSRF, CORS, XSS, and session fixation.
- Token revocation and recent authentication.
- App Check missing/invalid/replayed behavior.
- Upload type confusion and parser attacks.
- SSRF allowlist and redirect behavior.
- Prompt injection and unauthorized tool access.
- IAM-denied service operations.
- Secret rotation.
- Deletion and retention verification.
- Backup access and restore permissions.

## 27. Completion Criteria

- Every sensitive resource has an owner and authorization path.
- Production database and storage are not publicly accessible to clients.
- No long-lived cloud key is required by CI or workloads.
- Raw capture, precise location, and signed URLs are absent from ordinary telemetry.
- Account deletion covers every authoritative, derived, and provider-controlled copy in scope.
- Security-relevant administrative access is time-limited and audited.
