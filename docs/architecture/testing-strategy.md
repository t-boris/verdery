# Testing Strategy

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines automated testing layers, environments, fixtures, contract tests, geometry equivalence, offline fault injection, security tests, performance tests, and release gates.

## 2. Principles

- Test behavior at the lowest reliable layer.
- Use real PostgreSQL/PostGIS for persistence behavior.
- Keep cross-platform contracts executable.
- Make time, identifiers, providers, and failures deterministic.
- Treat offline synchronization, geometry, authorization, and deletion as critical systems.
- Do not rely on staging end-to-end tests as the only validation.

## 3. Test Pyramid

```text
             exploratory and device validation
                   end-to-end tests
              service integration tests
        module, component, and contract tests
                  pure unit tests
```

Most domain cases remain fast unit or module tests. A smaller set proves deployed-system wiring.

## 4. Shared Test Assets

`packages/test-fixtures` contains language-neutral fixtures for:

- OpenAPI examples.
- Garden and map documents.
- Valid and invalid GeoJSON.
- Coordinate transformations and calibration.
- Revision conflicts.
- Sync push/pull scenarios.
- Provider-normalization examples.
- Recommendation evidence and expected outcomes.

Fixtures include schema version and documented numeric tolerances.

## 5. Backend Unit Tests

Test:

- Domain entities and value objects.
- Use-case policies.
- Role capabilities.
- Task and recommendation transitions.
- Retention decisions.
- Retry classification.
- Provider-independent mapping.

Use injected clock, UUID generator, policy, and port fakes.

## 6. Backend Integration Tests

Use Testcontainers or equivalent to run the supported PostgreSQL/PostGIS image.

Test:

- Migrations.
- Repository mapping.
- Spatial constraints and queries.
- Transactions and expected revisions.
- Idempotency.
- Transactional outbox.
- Sync change ordering.
- Deletion and ownership constraints.
- Query plans for critical paths where stable.

SQLite is not a substitute for server persistence tests.

## 7. API Contract Tests

- Lint OpenAPI.
- Detect breaking changes against the released contract.
- Generate and compile Swift and TypeScript clients.
- Validate request and response examples.
- Exercise authentication, authorization, idempotency, concurrency, pagination, errors, and size limits.
- Ensure handlers do not return undocumented fields or statuses where strict validation applies.

## 8. Native Tests

Use Swift Testing and XCTest as appropriate for:

- Domain and application use cases.
- GRDB migrations and atomic outbox writes.
- Sync state machine.
- View-model behavior.
- URLSession gateway mapping.
- Map command and geometry fixtures.
- Accessibility identifiers and critical UI flows.
- Background upload recovery.

Real-device suites cover ARKit, camera, depth capability, lifecycle, background execution, and push notifications.

## 9. Web Tests

Use:

- Vitest for pure logic.
- Testing Library for components and accessible behavior.
- Mock Service Worker for typed API outcomes.
- Playwright for browser end-to-end behavior.
- Automated accessibility checks.
- Visual regression for stable responsive and editor states.

Supported browser coverage includes current supported Safari, Chrome, Firefox, and Edge release lines according to the launch matrix.

## 10. Geometry Equivalence

Swift, TypeScript, and backend tests consume shared fixtures for:

- Point, line, polygon, and supported multi-geometry round trips.
- Local/WGS84 transforms.
- Plan calibration.
- Self-intersection and containment.
- Hit-test and snap expectations where semantics are shared.
- Measurement conversion.
- Floating-point tolerance.
- Proposal acceptance and revision.

Renderer-specific pixels may differ; canonical commands and validation outcomes must agree.

## 11. Offline Synchronization Tests

Fault injection occurs at every durable boundary:

- Before and after local commit.
- Before request send.
- After server commit but before response.
- During partial batch response.
- Before and after pull-page local commit.
- During auth expiration.
- During membership revocation.
- During schema migration with pending outbox.
- During media completion.

Long-running randomized state-machine tests compare local and server convergence after recovery.

## 12. Authorization Tests

Maintain a capability matrix for owner, editor, viewer, organization admin, assigned professional, unassigned organization member, active client, revoked client, non-member, suspended user, support grant, and system worker.

Every resource test includes:

- Same-garden allowed behavior.
- Cross-garden denial.
- Concealed not-found behavior where required.
- Membership removed immediately before mutation.
- Stale token with current server role.
- Bulk operation containing unauthorized resource.
- Client engagement from another garden or organization.
- Client request for unpublished, withdrawn, or internal operational data.
- Organization member without a garden assignment.
- Published media not included in the requested publication.

## 13. Media Tests

- Interrupted resumable upload.
- Duplicate completion.
- Size, MIME, signature, and checksum mismatch.
- Malformed images, videos, PDFs, and archives.
- Malware-scanner outcome.
- Unauthorized signed access.
- Derivative determinism and versioning.
- Lifecycle and deletion races.
- Orphan reconciliation.

Malicious fixtures are isolated and never rendered by ordinary CI tooling.

## 14. Async Tests

- Duplicate task and Pub/Sub delivery.
- Outbox relay crash after publish.
- Bounded retry and dead letter.
- Cancellation.
- Late stale job result.
- Job checkpoint resume.
- Workflow partial failure.
- Queue overload and backpressure.
- IAM invocation denial.

## 15. AI Evaluation Tests

- Deterministic recommendation rule fixtures.
- Missing and stale evidence.
- Schema-constrained model output.
- Unsupported-fact rejection.
- Prompt injection.
- Safety-tier restrictions.
- Russian and English quality.
- Model timeout and deterministic fallback.
- Cost and latency threshold.

Live model evaluations are separated from deterministic CI and run under controlled budget.

## 16. Security Tests

- CSRF, CORS, XSS, and session handling.
- Broken object-level authorization.
- App Check enforcement modes.
- SSRF and webhook replay.
- Upload parser attacks.
- Secret scanning and dependency vulnerabilities.
- Cloud provisioning policy, script-safety, and public-access checks.
- Prompt/tool authorization.
- Log-redaction tests.

## 17. Migration Tests

- Fresh schema creation.
- Upgrade from every supported prior release baseline.
- Expand/contract compatibility with old and new API revisions.
- Representative data volume.
- PostGIS extension compatibility.
- Roll-forward correction.
- Mobile local database migrations with pending operations.

## 18. Performance Tests

Measure:

- API route latency and throughput.
- Cloud SQL connection saturation.
- Spatial viewport and validation queries.
- Sync backlog convergence.
- Map frame rate and interaction latency.
- Upload and verification throughput.
- Worker duration, memory, and CPU/GPU use.
- Next.js bundle and web vitals.

Performance fixtures represent small, ordinary, large, and pathological gardens.

## 19. Resilience Tests

- Provider timeout and quota.
- Database connection reset.
- Cloud Run instance termination.
- Queue delay.
- Storage temporary failure.
- Firebase auth/FCM degradation behavior.
- Backup restore and regional-recovery tabletop.

## 20. End-to-End Scenarios

Critical scenarios are:

- Register and create first garden.
- Draw lot, house, deck, fence, path, bed, tree, and plant.
- Import and calibrate a property plan.
- Work offline, restart, and synchronize.
- Encounter and resolve a geometry conflict.
- Upload media and review processing.
- Accept or reject a capture proposal.
- Receive and complete a recommendation/task.
- Invite editor and verify viewer restrictions.
- Invite an equal household owner or operational editor and complete assigned work with attribution.
- Publish a client update, verify the client sees only entitled results, then withdraw or revoke it.
- View an actual client garden timeline and a separately published future Time Machine scenario.
- Export and request account deletion.

## 21. Test Data

- Synthetic by default.
- No production secrets.
- No uncontrolled production media.
- Stable seed and factory APIs.
- Explicit locale, time zone, and clock.
- Resettable environment ownership.
- Privacy-reviewed consented datasets only for capture/model evaluation.

## 22. CI Gates

Pull requests require affected:

- Formatting and linting.
- Type checking and compilation.
- Unit and integration tests.
- Contract compatibility.
- Migration tests.
- Documentation checks.
- Security and dependency scans.
- gcloud script/configuration validation and read-only environment verification where credentials are available.

Release promotion adds end-to-end, performance-risk, migration rehearsal, and production-readiness checks.

## 23. Flaky-Test Policy

Flaky tests are defects. A quarantined test requires owner, issue, reason, and deadline. Quarantine cannot silently weaken a security, sync, migration, or release-critical gate.

## 24. Completion Criteria

- Core domain behavior is tested without cloud access.
- Persistence tests use real PostgreSQL/PostGIS.
- Offline failures are injected at durable boundaries.
- Geometry fixtures agree across platforms.
- Authorization tests attempt cross-garden access for every resource.
- Authorization tests also attempt cross-organization, cross-engagement, and operational/client access-plane confusion.
- Release gates include documentation and migration compatibility.
