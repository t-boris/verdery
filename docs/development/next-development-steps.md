# Next development steps

> Snapshot: September 25, 2026. This is a handoff for the next development session, not a release
> approval. Recheck live state before changing a gate status.

The repository has an implemented Foundation and Phase 9, but implementation completion does not
approve the owner-controlled G2–G8 gates or make a production release ready. The detailed queue is
in [tasks/todo.md](../../tasks/todo.md), under "Repository hygiene, Epic 0 verification, and
Foundation gates G2–G8". The [G8 checklist](ga-checklist.md) defines release evidence.

## Immediate verification

1. Reconcile the point-in-time deployment claims in the G8 checklist and
   [implementation plan](../implementation-plan.md) with live development state. Record the actual
   worker deployment, iOS build, restore drill, and provider status with dated evidence. Do not
   promote a checked implementation task into an approved release gate.
2. Complete Epic 0 issue verification on the deployed web app and iPhone Simulator. Record results
   in each issue under [issues/](issues/) and advance its state only when the observed behavior
   matches the acceptance criteria.
3. Exercise the care loop on a real development garden: accept one taxon's seasonal timing and
   observe a sowing-window recommendation. Re-read the dry-spell rule's inputs for the garden
   identified in [tasks/remaining-work.md](../../tasks/remaining-work.md), read-only, before
   changing the rule.
4. After a development deploy, request and download a data export. The ZIP writer now uses
   `archiver` 8; the round-trip tests cover package structure, while this live check covers the
   worker, storage, authentication, and download path together.

## Engineering sequence

1. Write the domain rules for server-side map validation, then implement cross-object checks and
   test the `validationSummary` returned by the map read endpoint.
2. Make the existing Playwright suite a CI gate and add browser journeys for map editing and for
   plant, observation, and task records. Add the native first-garden UI test.
3. Close the remaining G8 automation gaps: documentation links, image-digest deployment,
   per-revision metrics, dev post-deploy checks, and a point-in-time recovery drill script.
4. Prepare evidence scripts for owner-operated cross-device, offline, upload-recovery, and push
   notification checks. Record G2–G6 reviews in the G9 review format; leave approval to the owner.

The remaining owner decisions and prerequisites for private beta and US GA are listed in
[tasks/todo.md](../../tasks/todo.md), sections A4–A5. Staging, production, legal/privacy review,
horticultural sign-off, and real-device evidence are still separate from repository CI.

## Dependency baseline

The September maintenance pass moved the workspace to Vitest 5, the API and workers to
`@google-cloud/storage` 8 and `google-auth-library` 11, and the export writer to `archiver` 8.
TypeScript remains on 5.9 per [ADR-0009](../architecture/decisions/ADR-0009-toolchain-and-platform-baseline.md)
and the explicit Dependabot ignore. For future major upgrades, run the fresh-checkout CI commands
in [ci-gates.md](ci-gates.md), then exercise the affected development service path before marking
the upgrade operationally verified.
