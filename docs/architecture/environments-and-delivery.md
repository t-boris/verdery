# Environments and Delivery Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines the monorepo delivery model, environment isolation, Terraform ownership, GitHub Actions, build artifacts, migrations, release promotion, feature flags, rollback, and supply-chain controls.

## 2. Environments

Persistent environments are:

- Development.
- Staging.
- Production.

Each uses a separate Firebase and Google Cloud project with separate identity configuration, database, buckets, service identities, queues, topics, secrets, domains, telemetry, and budgets.

Local development uses local containers, test Firebase projects/emulators where accurate, and controlled development resources. Production data is never copied into local or development systems without an approved anonymization process.

## 3. Environment Purpose

### Development

- Rapid integration.
- Synthetic or disposable data.
- Lower availability and cost.
- Safe provider sandbox credentials.

### Staging

- Production-like topology.
- Release-candidate validation.
- Migration rehearsal.
- Load, recovery, and security tests.
- No real customer data by default.

### Production

- Real users and sensitive data.
- Restricted access and change controls.
- Regional HA database.
- Protected ingress and private database networking.
- Production SLOs, alerts, backup, and retention.

## 4. Infrastructure as Code

Terraform owns:

- Google Cloud projects or project-level resources as organizational access permits.
- APIs and service identities.
- IAM bindings.
- VPCs, subnets, private service access, and load balancing.
- Cloud Run services and jobs or their infrastructure shells.
- Cloud SQL.
- Buckets and lifecycle rules.
- Pub/Sub, Cloud Tasks, Scheduler, and Workflows.
- Secret containers, not secret plaintext.
- Monitoring policies and budgets where supported.
- DNS and certificates where supported.

Manual console changes are incident-only or exploratory and must be reconciled into Terraform or reverted.

## 5. Terraform Structure

```text
infrastructure/terraform/
├── modules/
│   ├── project-services/
│   ├── networking/
│   ├── cloud-sql/
│   ├── cloud-run-service/
│   ├── cloud-run-job/
│   ├── storage/
│   ├── messaging/
│   ├── observability/
│   └── edge/
└── environments/
    ├── development/
    ├── staging/
    └── production/
```

Remote state is encrypted, access-controlled, locked, and separated by environment.

## 6. CI/CD Identity

GitHub Actions authenticates to Google Cloud through workload identity federation. Downloaded long-lived service-account keys are prohibited.

Separate identities exist for:

- Pull-request validation.
- Development deployment.
- Staging deployment.
- Production deployment.

Production identity receives only required deploy permissions and is protected by GitHub environment approval and branch policy.

## 7. Change Detection

CI determines affected surfaces while always validating shared contracts and documentation when relevant.

Typical jobs are:

- Documentation checks.
- TypeScript lint, typecheck, tests, and build.
- Swift build and tests on supported runner.
- OpenAPI compatibility and client generation.
- PostgreSQL migration tests.
- Python lint, typecheck, tests, and container build.
- Terraform format, validate, security scan, and plan.
- Container vulnerability scan.
- End-to-end tests for release candidates.

## 8. Build Artifacts

- API and workers build immutable OCI images.
- Images are stored in Artifact Registry.
- Deployments reference image digest, not mutable tag alone.
- Build metadata includes source commit, contract version, migration compatibility, and dependency lock state.
- Web builds are reproducible from lockfile and pinned supported runtime.
- iOS releases are tied to source and API compatibility metadata.

## 9. Branch and Promotion Model

- Pull requests validate changes and may create isolated previews for web when safe.
- Merge to the main branch may deploy development automatically.
- A selected immutable artifact is promoted to staging.
- Production promotion uses the same tested artifact, not a rebuild.
- Production requires explicit approval until operational maturity justifies more automation.

## 10. Web Delivery

Firebase App Hosting deploys the pinned supported Next.js application. Configuration is versioned through Firebase and repository files where supported.

Preview environments must not share production sessions, secrets, or CORS trust. Public preview URLs do not receive production APIs by default.

## 11. Backend Deployment

Cloud Run deployment sets:

- Immutable image digest.
- Dedicated service account.
- Region.
- CPU, memory, concurrency, min/max instances.
- Direct VPC egress where required.
- Secret references.
- Ingress policy.
- Startup and liveness probes.
- Revision labels.

Traffic moves gradually for production when the change risk warrants canary validation.

## 12. Database Migrations

Migrations are a controlled release step:

1. CI upgrades representative prior schemas.
2. Staging rehearses against production-like volume.
3. Migration compatibility is reviewed with current and new application versions.
4. Production migration runs through a dedicated identity.
5. Application traffic shifts only after required expand-phase changes succeed.
6. Contract-phase destructive cleanup occurs in a later release after old clients and servers are retired.

Application containers do not automatically run uncontrolled migrations on every startup.

## 13. Mobile Compatibility

The backend supports a documented window of released mobile client versions. API and sync changes are additive or versioned.

The service can return:

- Supported.
- Upgrade recommended.
- Upgrade required while preserving local recovery.

Mobile release lag is considered before removing fields, commands, sync payload versions, or authentication behavior.

## 14. Feature Flags

Feature flags separate deployment from release for risky capabilities such as Garden Scan, model versions, App Check enforcement, new sync operations, or map-provider changes.

Flags have:

- Owner.
- Purpose.
- Default.
- Environment scope.
- Targeting policy.
- Expiration or cleanup date.
- Telemetry.

Flags do not replace authorization or become permanent configuration debt.

## 15. Rollback

### Application

Cloud Run traffic returns to a known compatible revision. Web rolls back to a retained compatible build or redeploys the prior source revision.

### Database

Prefer forward correction. Destructive rollback scripts are not assumed safe. Expand/contract migrations preserve compatibility with the prior application during the rollback window.

### Feature

Feature flag or provider configuration disables the capability while preserving accepted domain data.

### Mobile

Server compatibility and remote configuration mitigate defects while an App Store update is reviewed.

## 16. Secrets and Configuration

- Secret plaintext is entered through approved operational workflow.
- Terraform creates secret resources and IAM but does not commit values.
- Environment configuration is typed and versioned.
- Production config changes are reviewed.
- Runtime startup fails on missing required config.
- Provider credentials are separate by environment.

## 17. Supply Chain

- Lock dependencies.
- Verify package and image provenance where supported.
- Scan dependencies, secrets, Terraform, and containers.
- Pin GitHub Actions to trusted versions or commit SHAs according to policy.
- Restrict package publication and CI token permissions.
- Maintain software-bill-of-materials capability for production artifacts.

## 18. Release Verification

Before production:

- CI and staging tests pass.
- Migration plan and rollback compatibility are approved.
- Observability and alerts exist for changed critical paths.
- Security/privacy review is complete for new data flows.
- Cost and quota impact is understood.
- Documentation is synchronized.
- Mobile/web compatibility is verified.

## 19. Emergency Changes

Emergency changes use the narrowest safe path, require post-change reconciliation into source control, and receive retrospective review. Manual production configuration cannot remain undocumented.

## 20. Completion Criteria

- Environments share modules but not identities or data.
- Production deployments use immutable tested artifacts.
- CI uses federation instead of cloud keys.
- Database changes preserve rolling and mobile compatibility.
- Rollback is rehearsed for application revisions.
- Every material change updates its architecture and operational documentation.
