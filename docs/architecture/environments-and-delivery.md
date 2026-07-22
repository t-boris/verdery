# Environments and Delivery Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines the monorepo delivery model, environment isolation, initial gcloud-script ownership, GitHub Actions, build artifacts, migrations, release promotion, feature flags, rollback, and supply-chain controls.

## 2. Environments

Persistent environments are:

- Development.
- Staging.
- Production.

Only the development project currently exists. Staging and production are target environments created closer to foundation hardening through the same environment-driven scripts, with their own approval and production controls.

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

## 4. Infrastructure Provisioning Source

Versioned, idempotent scripts under `infrastructure/gcloud` are the authoritative provisioning mechanism for every resource they manage. The current development implementation covers project/billing linkage, APIs, IAM/service accounts, VPC/private service access, Cloud SQL, Artifact Registry, workload identity federation, the API service, and its migration job.

As dependent product phases arrive, the same script structure expands to own:

- Buckets and lifecycle rules.
- Pub/Sub, Cloud Tasks, Scheduler, and Workflows.
- Secret containers, not secret plaintext.
- Monitoring policies and budgets where supported.
- DNS and certificates where supported.
- Production load balancing and edge protection.

Manual console changes are incident-only or exploratory and must be reconciled into the scripts and environment configuration or reverted.

Terraform is not authoritative during the initial single-operator phase. Its directory is reserved for a future multi-environment, multi-operator decision and import plan.

## 5. gcloud Script Structure

The current implementation contains `dev.env`. The `staging.env` and `prod.env` entries below are
target files created when those environments are approved; they do not exist yet.

```text
infrastructure/gcloud/
├── config/
│   ├── dev.env
│   ├── staging.env
│   └── prod.env
└── scripts/
    ├── lib/
    ├── 00-create-project.sh
    ├── 01-enable-apis.sh
    ├── 02-network.sh
    ├── 03-cloud-sql.sh
    ├── 04-artifact-registry.sh
    ├── 05-service-accounts.sh
    ├── 06-workload-identity-federation.sh
    ├── 07-iam-database-bootstrap.sh
    ├── provision.sh
    ├── verify.sh
    ├── deploy-migration-job.sh
    └── deploy-api.sh
```

Each mutating script is safe to rerun, reads environment-specific values from configuration, reports what it changed, and has a corresponding read-only verification path. Destructive changes require a dedicated reviewed command and are never hidden behind ordinary reconciliation.

## 6. CI/CD Identity

GitHub Actions authenticates to Google Cloud through workload identity federation. Downloaded long-lived service-account keys are prohibited.

The current development deploy identity is implemented. The target environment model uses separate identities for:

- Pull-request validation.
- Development deployment.
- Staging deployment.
- Production deployment.

Production identity receives only required deploy permissions and is protected by GitHub environment approval and branch policy.

## 7. Change Detection

CI determines affected surfaces while always validating shared contracts and documentation when relevant.

The required target CI set is below. The current implemented subset and explicit gaps are tracked in [../development/ci-gates.md](../development/ci-gates.md).

- Documentation checks.
- TypeScript lint, typecheck, tests, and build.
- Swift build and tests on supported runner.
- OpenAPI compatibility and client generation.
- PostgreSQL migration tests.
- Python lint, typecheck, tests, and container build.
- Shell formatting/static analysis, configuration validation, script safety checks, and read-only environment verification where credentials are available.
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
- Merge to the repository's default branch (`master` currently) may deploy development automatically.
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
- Provisioning scripts create secret containers and IAM but do not commit plaintext values.
- Environment configuration is typed and versioned.
- Production config changes are reviewed.
- Runtime startup fails on missing required config.
- Provider credentials are separate by environment.

## 17. Supply Chain

- Lock dependencies.
- Verify package and image provenance where supported.
- Scan dependencies, secrets, shell scripts, cloud configuration, and containers.
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
