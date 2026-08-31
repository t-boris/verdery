# GG-NNNN: Concise issue title

| Field          | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Status         | `reported`                                                     |
| Severity       | `SEV-N`                                                        |
| Surface        | `web`, `iOS`, `API`, or `shared`                               |
| Code finding   | `supported`, `plausible`, `not-supported`, or `needs-evidence` |
| First reported | `YYYY-MM-DD`                                                   |
| Last updated   | `YYYY-MM-DD`                                                   |

## Summary

One paragraph describing the user-visible problem and the scope of the issue. Keep conclusions out
of this section until analysis supports them.

## Observations

| Observation | Date       | Surface and version | Expected | Actual | Reproducibility              |
| ----------- | ---------- | ------------------- | -------- | ------ | ---------------------------- |
| OBS-001     | YYYY-MM-DD | Web 0.0.0           | …        | …      | once / intermittent / always |

Include environment details, timestamps, error codes, and correlation IDs when available. Do not
include secrets or user content.

## Code analysis

### Finding

State whether the report is supported by the code, merely plausible, contradicted by the code, or
requires runtime evidence. Explain the boundary of that conclusion.

### Evidence

- `path/to/file.ext` — relevant symbol or behavior.

### Affected surface

List the routes, screens, workflows, API operations, shared contracts, or data states that can be
affected. Note explicitly when a shared cause spans web and iOS.

### Likely cause

Describe the narrowest common root cause supported by the evidence. Separate verified facts from
inference.

## Reproduction and validation

1. Record minimal reproduction steps or explain why reproduction is not yet possible.
2. Name the automated, manual, browser, simulator, or device check that should verify a fix.

## Resolution

Record the chosen change, relevant commit or pull request, tests added, and verification result.
Leave this section pending until work begins; do not treat a proposed fix as completed.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change           |
| ---------- | ---------------- |
| YYYY-MM-DD | Report recorded. |
