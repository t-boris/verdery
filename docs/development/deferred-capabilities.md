# Deferred capabilities

What a developer cannot do in this repository yet, and what has to exist first. Everything listed
here is deferred deliberately; none of it is an oversight, and none of it should be worked around
locally.

## Nothing deploys anywhere

There is no deploy workflow, no environment, and no cloud project.

The architecture requires GitHub Actions to authenticate to Google Cloud through workload identity
federation, with a separate identity for pull-request validation, development, staging, and
production, and it prohibits downloaded long-lived service-account keys. It also requires
deployments to reference an immutable image digest in Artifact Registry.

None of that infrastructure exists. A deploy workflow written today could only either commit a
long-lived key — which the supply-chain policy forbids — or authenticate against identities that
have never been created. Both are worse than having no workflow, because a broken deploy path that
looks configured invites someone to "fix" it with a key.

The relevant work packages are `P1-PLAT-02` (separate development, staging, and production
Firebase/Google Cloud projects) and `P1-PLAT-03` (workload identity federation, Artifact Registry,
immutable images, per-environment deploy identities). Both require a real Google Cloud organization
with billing.

Source: [../architecture/environments-and-delivery.md](../architecture/environments-and-delivery.md),
sections "6. CI/CD Identity", "8. Build Artifacts", and "17. Supply Chain";
[../implementation-plan.md](../implementation-plan.md), section 10.2.

## There is no Terraform

`infrastructure/terraform` is empty. Terraform modules for project services, IAM, network, Cloud
SQL, Cloud Run, storage, messaging, observability, and edge are work package `P1-PLAT-01`, and
Terraform is not installed on the machine this foundation was built on, so nothing could be
validated.

The architecture lists Terraform format, validate, security scan, and plan as a pull-request gate.
That gate is absent from CI on purpose: a validation job with no files to validate reports success
without checking anything, which is worse than an acknowledged gap.

## No container images are built or scanned

The API and workers are meant to build immutable OCI images stored in Artifact Registry, and images
are meant to be vulnerability-scanned in CI. There is no registry to publish to, so neither the
build nor the scan exists. This unblocks with `P1-PLAT-03`.

## Observability exports nowhere

`P1-OBS-01` requires OpenTelemetry traces, structured redacted logs, correlation identifiers, and
initial dashboards. Correlation identifiers and structured logging exist in the API service, but
there is no Google Cloud project to export traces or metrics to and no dashboard to create, so the
completion evidence — "one request trace crosses ingress and database" — cannot be produced.

## Staging and production database procedure is unrehearsed

Migrations run correctly against a throwaway container locally and in CI. The operational
procedure — staging rehearsal against production-like volume, production migration through a
dedicated identity, traffic shifted only after the expand phase succeeds — cannot be rehearsed
without those environments. See [database-migrations.md](database-migrations.md).

## End-to-end tests

End-to-end tests are a release-promotion gate, not a pull-request gate, and they need a deployed
environment to run against. There is none.

## What is _not_ deferred

To be clear about the boundary, all of the following are implemented and gated in CI: the pnpm
workspace and its version pins, the OpenAPI contract and its generated client, shared geometry
semantics, language-neutral fixtures shared between TypeScript and Swift, the SQL migration system
and its tests, the API composition root and health endpoints, the web application shell, the Swift
package and its targets, formatting, linting, type checking, the file-size rule, and the secret
scan.
