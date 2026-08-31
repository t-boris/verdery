# Collaborative issue registry

This folder is the durable record for observations found during collaborative product testing.
Testing proceeds through the **web surface first, then iOS**. A report is an observation until code
analysis or reproduction supports a stronger conclusion; recording it here does not by itself mean
the product has a defect.

## Registry

| ID      | Status   | Severity | Surface           | Code finding | Title                                                                       | Observations | Record                                                     |
| ------- | -------- | -------- | ----------------- | ------------ | --------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| GG-0001 | analyzed | SEV-4    | web               | supported    | Sign-in composition obscures its image and lacks responsive visual coverage | 1            | [GG-0001](GG-0001-sign-in-composition.md)                  |
| GG-0002 | analyzed | SEV-5    | web / API / data  | supported    | Archive-first permanent deletion without a mandatory recovery delay         | 1            | [GG-0002](GG-0002-archive-first-permanent-deletion.md)     |
| GG-0003 | fixed    | SEV-4    | web               | supported    | Garden details card stretches into an empty panel                           | 1            | [GG-0003](GG-0003-garden-details-empty-panel.md)           |
| GG-0004 | analyzed | SEV-3    | web / API / data  | supported    | Garden environment facts lack a usable setup and summary flow               | 1            | [GG-0004](GG-0004-garden-environment-setup-flow.md)        |
| GG-0005 | fixed    | SEV-3    | web               | supported    | Garden Map inspector and object list are difficult to read and operate      | 2            | [GG-0005](GG-0005-map-workspace-and-inspector.md)          |
| GG-0006 | analyzed | SEV-3    | web               | supported    | Garden Map canvas labels, controls, and Fit behavior compete with the plan  | 1            | [GG-0006](GG-0006-map-canvas-density-and-fit.md)           |
| GG-0007 | fixed    | SEV-3    | web / API         | supported    | Today weather periods and missing measurements are difficult to interpret   | 1            | [GG-0007](GG-0007-today-weather-hierarchy-and-coverage.md) |
| GG-0008 | analyzed | SEV-3    | web / API         | supported    | Automatic Checks overstate readiness and hide per-target eligibility        | 1            | [GG-0008](GG-0008-automatic-checks-claims.md)              |
| GG-0009 | analyzed | SEV-4    | web / API / media | supported    | Plant photos load through per-image request waterfalls and original assets  | 1            | [GG-0009](GG-0009-plant-image-loading.md)                  |
| GG-0010 | analyzed | SEV-3    | web / API         | supported    | Observation capture exposes implementation fields before the primary task   | 1            | [GG-0010](GG-0010-observation-quick-capture.md)            |

Create records from [ISSUE-TEMPLATE.md](ISSUE-TEMPLATE.md) and name them
`GG-NNNN-short-description.md`. Assign IDs monotonically and never reuse an ID, including after an
item is closed or consolidated.

## Triage rules

- Preserve the reporter's expected and actual behavior as an observation, separate from analysis.
- Classify the code finding as `supported`, `plausible`, `not-supported`, or `needs-evidence`, and
  cite the relevant paths and symbols. State what the code proves and what still needs runtime
  evidence.
- Keep one issue per likely root cause. Add repeated symptoms to its observation table instead of
  opening duplicates. If one report has independent causes, split it into linked records.
- When consolidating, keep the retired record, set its status to `consolidated`, and link the
  surviving record. When splitting, link every child from the original record.
- Use the SEV-1 through SEV-5 impact definitions in
  [support-operations.md](../support-operations.md). Privacy exposure is always SEV-1; a potentially
  harmful recommendation is at least SEV-2.
- Do not store credentials, tokens, cookies, signed URLs, user exports, or screenshots containing
  another person's data.

## Lifecycle

`reported` → `analyzed` → `planned` → `fixed` → `verified` → `closed`

Use `needs-evidence` when code inspection cannot settle the report, `not-supported` when the
reported behavior is contradicted by the inspected code or expected design, and `consolidated` for
a record replaced by another issue. Reopen a closed record only when the same root cause remains;
otherwise create and relate a new record.

## Delivery plan

[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) turns every current registry record into an
ordered implementation, verification, rollout, and decision plan. The issue records remain the
source of truth for scope and acceptance criteria.
