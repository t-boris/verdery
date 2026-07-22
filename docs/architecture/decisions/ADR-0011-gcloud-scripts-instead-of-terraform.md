# ADR-0011: Idempotent gcloud Scripts Instead of Terraform for Initial Infrastructure

> Status: Accepted  
> Date: July 22, 2026

## Context

The repository shape defined in the architecture reserves `infrastructure/terraform/` for
provisioning, and work package `P1-PLAT-01` calls for "Terraform modules for project services, IAM,
network, Cloud SQL, Cloud Run, storage, messaging, observability, and edge shells."
[Source: architecture/README.md, section "5. Repository Shape"; implementation-plan.md, work
package P1-PLAT-01]

The repository owner directed that this phase of infrastructure work use gcloud CLI scripts instead
of Terraform.

Separately, the Google Cloud account available for this work has no GCP organization —
`gcloud organizations list` returns zero results — so every project is a standalone project under a
personal billing account rather than a project inside an organization with folders, org policies,
and centrally managed IAM. Terraform's usual advantages (a declarative diff against real state, a
remote state backend, drift detection) matter most when multiple people and multiple environments
share an organization; a single developer standing up one `verdery-dev` project gets a smaller share
of that benefit today.

## Decision

Provision Google Cloud infrastructure with versioned, idempotent shell scripts under
`infrastructure/gcloud/scripts/`, driven by `gcloud`, rather than with Terraform.

Each script:

- Is safe to re-run. It checks whether a resource already exists before creating it, rather than
  failing on the second run.
- Does one coherent unit of provisioning (project and APIs, networking, Cloud SQL, IAM and workload
  identity federation, Cloud Run and Artifact Registry) so a step can be re-run or reasoned about
  independently.
- Prints what it did and what it verified, so a run is legible without reading the script.
- Reads environment-specific values from `infrastructure/gcloud/config/<environment>.env` rather than
  hardcoding them, so the same script provisions `verdery-dev` today and `verdery-staging` or
  `verdery-prod` later without being rewritten.

`infrastructure/terraform/` remains in the repository shape as an empty placeholder. It is not
deleted, because a later, multi-environment, multi-operator phase of this project may still want
Terraform's state model, and the architecture's repository shape is not being changed — only the
tool used to fulfill `P1-PLAT-01`'s intent.

## Consequences

- There is no declarative source of truth that a diff can be run against before a change is applied.
  A script that no longer matches deployed reality is discovered by running it and reading its
  output, not by `terraform plan`. This is an accepted, explicit trade for the current single-project,
  single-operator scope.
- Idempotency is the script author's responsibility on every resource, rather than Terraform's
  provider layer providing it uniformly. Each script in this repository states in a comment which
  gcloud commands it treats as safe to fail (`|| true`) and why.
- Moving to Terraform later is not a rewrite from nothing: the scripts document, in executable form,
  exactly which resources exist, with which configuration, which is the input a Terraform import or
  a fresh module would need.
- Because there is no GCP organization, environment isolation is project-level rather than
  organization-policy-level. `verdery-staging` and `verdery-prod`, when created, are separate
  projects under the same personal billing account with no shared org policy enforcement — a
  weaker isolation guarantee than the architecture's target state assumes. This is recorded here
  rather than silently accepted: revisit before `verdery-prod` is created for a paying user's data.
