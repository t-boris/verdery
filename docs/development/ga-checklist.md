# G8 release checklist

> Work package: P8-GA-01, buildable half
> Status: **CHECKLIST. Nothing here has been run as a release-candidate gate, and the signature is
> an owner gate.**
> Drafted against the repository as of July 25, 2026

## 1. How to read this

P8-GA-01 is "**Run** release-candidate E2E suite, migration rehearsal, backup/restore, security
tests, documentation audit, artifact promotion, canary, and post-deploy validation", with a "Signed
G8 checklist" as its evidence. Running it is a release event; signing it is the owner's.

This document is the checklist itself: every gate, the exact command or procedure, the evidence that
satisfies it, and — where the gate cannot be executed at all — the precise blocker and who removes
it. It **cross-references** rather than duplicates:

- procedures for failure scenarios: [runbooks.md](runbooks.md) RB-01 … RB-09;
- threats, mitigations, and the security sign-off: [threat-model.md](threat-model.md);
- CI job definitions: [ci-gates.md](ci-gates.md);
- SLO targets a post-deploy validation is measured against: [service-levels.md](service-levels.md);
- the load harness a canary is watched with: [load-testing.md](load-testing.md);
- iOS release mechanics: [ios-distribution.md](ios-distribution.md);
- what is deliberately not built: [deferred-capabilities.md](deferred-capabilities.md).

Every gate carries one status:

| Mark | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| `A`  | **Automated.** CI runs it on every pull request. Evidence is the run.                                     |
| `M`  | **Manual, executable today.** The command works against what exists. Nobody has run it as a release gate. |
| `X`  | **Impossible today.** A named system does not exist. The blocker and its owner are stated.                |

**Summary of the 61 gates below: 19 automated, 26 manual, 16 impossible.** Section 10 lists the
sixteen together, because that list is the real content of this document.

## 2. Release candidate identity

Before any gate runs, the candidate must be a thing you can name.

| #   | Gate                        | Command / procedure                                                | Evidence                        | Status |
| --- | --------------------------- | ------------------------------------------------------------------ | ------------------------------- | ------ |
| 1   | Candidate commit is fixed   | `git rev-parse HEAD` on the release branch                         | The 40-character SHA            | `M`    |
| 2   | Working tree is clean       | `git status --porcelain` returns nothing                           | Empty output                    | `M`    |
| 3   | Lockfile is authoritative   | `pnpm install --frozen-lockfile`                                   | Exits 0 with no lockfile change | `A`    |
| 4   | Candidate carries a version | `SERVICE_VERSION` is a release identifier, not `0.0.0-development` | The live `/v1/health/live` body | `X`    |

**Gate 4 is impossible today and matters more than it looks.** `SERVICE_VERSION` is
`0.0.0-development` in the live environment (runbooks.md §1.7: "Not a release identifier yet"). Every
downstream gate that compares "before and after" — canary, post-deploy validation, error-budget
burn by release — has nothing to compare by. **Unblocked by**: stamping a version at build time in
`deploy-dev.yml`; small, mechanical, and it is a prerequisite for gates 24, 26, and 27.

## 3. Release-candidate test suite

| #   | Gate                             | Command                                                        | Evidence                                                                                              | Status |
| --- | -------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| 5   | Build from a clean checkout      | `pnpm build`                                                   | Exit 0                                                                                                | `A`    |
| 6   | Formatting and file size         | `pnpm format:check` and `pnpm check:file-size`                 | Exit 0; the 600-line rule holds (Markdown is exempt)                                                  | `A`    |
| 7   | Lint                             | `pnpm lint`                                                    | Exit 0, including the module-boundary rules                                                           | `A`    |
| 8   | Type check                       | `pnpm typecheck`                                               | Exit 0                                                                                                | `A`    |
| 9   | Unit and integration tests       | `pnpm test`                                                    | Full pass; record the file and test counts                                                            | `A`    |
| 10  | Contract lint                    | `pnpm --filter @verdery/api-contracts lint:contract`           | `redocly lint` reports valid                                                                          | `A`    |
| 11  | Generated client is in sync      | `pnpm --filter @verdery/api-contracts generate:check`          | No drift. Runs before any build, by design                                                            | `A`    |
| 12  | Swift package                    | `cd apps/ios && swift build && swift test`                     | Full pass on the pinned Xcode 26.6 toolchain                                                          | `A`    |
| 13  | Secret scan                      | TruffleHog, CI job `secret-scan`, never change-gated           | No verified secret in the diff                                                                        | `A`    |
| 14  | Aggregate gate                   | CI job `All gates`                                             | Green. Branch protection requires this and only this                                                  | `A`    |
| 15  | Browser E2E against a real stack | `apps/web/e2e/run-e2e.sh`                                      | Playwright pass against real Postgres, the Firebase Auth emulator, the real API, and the real web app | `M`    |
| 16  | Native device E2E                | Run the app on a real device across the full acceptance matrix | —                                                                                                     | `X`    |

**Gate 15 is `M`, not `A`.** The suite exists and passes, but does not run in CI. Making it a
release gate means either running it in CI or running it by hand and recording the output. Running
it by hand every release is a gate that will eventually be skipped.

**Gate 16 is impossible in this environment**: no physical device and no simulator. It is P8-UX-01's
acceptance matrix and P8-STORE-01's TestFlight pass. **Unblocked by**: owner, with an Apple
Developer account and a device (see ios-distribution.md).

## 4. Migration rehearsal

| #   | Gate                                  | Command / procedure                                                                                                               | Evidence                                                                                                    | Status |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| 17  | Migrations apply on an empty schema   | Migration test suite via `pnpm test` (Testcontainers)                                                                             | Pass                                                                                                        | `A`    |
| 18  | Every migration reverses              | Same suite — each migration carries a hand-maintained "migrate down N" count from the end of the chain                            | Down/up round trips pass. Adding one migration shifts every count, and the suite catches it                 | `A`    |
| 19  | Least-privilege role can migrate      | `platform-baseline.test.ts` runs migrations as an ordinary role, not the Testcontainers superuser                                 | Pass. This regression test exists because two real permission gaps were invisible to a superuser-only suite | `A`    |
| 20  | Migration runs against real Cloud SQL | `infrastructure/gcloud/scripts/deploy-migration-job.sh dev <image>` then `gcloud run jobs execute verdery-api-dev-migrate --wait` | Job succeeds; a re-run reports `appliedCount: 0` — correctly idempotent                                     | `M`    |
| 21  | Rehearsal on a production-shaped copy | Restore a backup to a scratch instance, migrate it, measure duration and lock behaviour                                           | —                                                                                                           | `X`    |
| 22  | Expand/contract order is respected    | Review the candidate's migrations against [database-migrations.md](database-migrations.md)                                        | Reviewer note naming each migration's phase                                                                 | `M`    |

**Gate 21 is impossible today.** It needs a database with production-shaped data volume, and there
is none — `verdery-dev` is effectively empty, so a migration that would lock a large table for
minutes completes instantly and proves nothing. The migration-shaped rollback problem is analysed in
runbooks.md RB-01 ("The migration-shaped rollback problem"); this gate is what would turn that
analysis into a measurement. **Unblocked by**: a staging environment plus a restore (gate 23), which
is itself blocked.

## 5. Backup and restore

| #   | Gate                                      | Command / procedure                                                        | Evidence                                      | Status |
| --- | ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| 23  | Backups exist and are recent              | `gcloud sql backups list --instance=<instance> --project=<project>`        | `SUCCESSFUL` rows within the retention window | `M`    |
| 24  | **A restore has actually been performed** | RB-02, executed end to end onto a scratch instance                         | —                                             | `X`    |
| 25  | Restore is timed against an RTO           | Same exercise, wall-clock recorded                                         | —                                             | `X`    |
| 26  | Point-in-time recovery works              | `gcloud sql instances clone <src> <dst> --point-in-time=<timestamp>`       | —                                             | `X`    |
| 27  | Post-restore verification passes          | RB-02's own post-restore checks (row counts, migration state, a live read) | —                                             | `X`    |

**All four are impossible today, and gate 24 is the most consequential unrun item in this
document.** Backups and PITR are real, enabled, and succeeding — four `SUCCESSFUL` backups, daily at
09:00 UTC, `retainedBackups: 7`, `pointInTimeRecoveryEnabled: true`, 7 days of transaction logs
(runbooks.md §1.2). But reliability-and-disaster-recovery.md §7 sets the standard: "Backups are not
considered valid until restoration is tested." **By that standard these backups are unvalidated,
and this checklist must not claim otherwise.**

**Unblocked by**: an owner-approved live action. A restore to a _new_ scratch instance is
non-destructive to `verdery-dev` and is the single highest-value hour of infrastructure work
available right now — it converts four unvalidated backups into a validated recovery path and
produces the RTO number gates 25 and the SLO draft both need.

## 6. Security gates

| #   | Gate                                | Command / procedure                                                                         | Evidence                                         | Status |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| 28  | Threat model is current             | Review threat-model.md against the candidate's diff                                         | Every new route appears in the register          | `M`    |
| 29  | Mitigation register is signed       | Owner signs the `accepted-risk-pending-signature` rows                                      | —                                                | `X`    |
| 30  | Authorization deny suites pass      | Part of `pnpm test`: cross-garden, role, and concealment (`notFound` vs `forbidden`) suites | Pass                                             | `A`    |
| 31  | Offline replay tests pass           | Sync idempotency, fingerprint mismatch, and stale-authorization suites                      | Pass                                             | `A`    |
| 32  | Malicious upload tests pass         | Validation-policy suites: MIME signature mismatch, dimension bombs, PDF active content      | Pass                                             | `A`    |
| 33  | Web session tests pass              | CSRF double-submit, exact-origin CORS, session verification suites                          | Pass                                             | `A`    |
| 34  | AI boundary tests pass              | Schema validation, safety filter, fallback suites — with the kill-switch in both states     | Pass                                             | `A`    |
| 35  | No user-managed service-account key | The audit loop in runbooks.md §1.4                                                          | Every line returns `0`                           | `M`    |
| 36  | Container image vulnerability scan  | —                                                                                           | —                                                | `X`    |
| 37  | Dependency vulnerability triage     | `pnpm audit`, reviewed rather than gated                                                    | A reviewed advisory list with a decision on each | `M`    |
| 38  | Edge enforcement is live            | CSP and Cloud Armor observe → enforce; App Check monitor → enforce                          | —                                                | `X`    |

**Gate 36** is a known missing CI gate (ci-gates.md, "Gates the architecture requires that do not
exist yet"), and images build and publish to Artifact Registry today with no scan. **Unblocked by**:
enabling Artifact Registry vulnerability scanning — an owner-confirmed live action, then a CI check
on the result.

**Gate 38** is P8-SEC-02, which the phase plan itself records as wanting beta telemetry that does not
exist. There is additionally **no load balancer and therefore no Cloud Armor**, so half of this gate
has nothing to enforce on until P8-NET-01. **Unblocked by**: P8-NET-01, then P8-SEC-02.

**Gate 29** is the owner's signature on threat-model.md's register — 92 threats, 5 currently
`accepted-risk-pending-signature`. It is the security half of G8 and is a decision, not a task.

## 7. Documentation audit

| #   | Gate                                  | Procedure                                                                         | Evidence                       | Status |
| --- | ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ | ------ |
| 39  | Docs match the candidate              | Review every `docs/` change in the candidate's diff against the code it describes | Reviewer note                  | `M`    |
| 40  | Runbooks name what actually exists    | Re-run runbooks.md §1's ground-truth commands and diff against what §1 claims     | Each table matches live output | `M`    |
| 41  | Runbook step dispositions are current | Every `U` (unexercised) step still names a real blocker                           | Per-runbook disposition tables | `M`    |
| 42  | Deferred capabilities are accurate    | Review deferred-capabilities.md — it is corrected whenever the boundary moves     | Reviewer note                  | `M`    |
| 43  | Links resolve                         | —                                                                                 | —                              | `X`    |
| 44  | Contract documentation matches        | `redocly lint` plus a read of changed operation descriptions                      | Gate 10, plus a reviewer note  | `M`    |

**Gate 43 is impossible today** only in the sense that no tool does it: there is no link checker
(ci-gates.md names it as a missing gate). This is the cheapest item in the entire document to fix
and is worth doing before the audit rather than after, because gate 39's diff review is exactly when
a stale link is introduced.

## 8. Artifact promotion and canary

| #   | Gate                                       | Command / procedure                                                                                                                 | Evidence                                        | Status |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| 45  | The artifact is immutable and identified   | Capture the image **digest**, not the tag: `gcloud artifacts docker images describe <image> --format='value(image_summary.digest)'` | A `sha256:` digest recorded in the release note | `M`    |
| 46  | The same artifact is promoted, not rebuilt | Deploy by digest to each environment                                                                                                | —                                               | `X`    |
| 47  | Canary receives a traffic slice            | `gcloud run services update-traffic <service> --to-revisions=<new>=10,<current>=90`                                                 | Traffic split confirmed                         | `M`    |
| 48  | Canary is watched against the SLOs         | Compare the canary revision's error rate and latency against the incumbent's for a defined bake time                                | —                                               | `X`    |
| 49  | Canary rollback is one command             | `gcloud run services update-traffic <service> --to-revisions=<current>=100`                                                         | RB-01, exercised                                | `M`    |
| 50  | Promotion to production                    | —                                                                                                                                   | —                                               | `X`    |

**Gate 46 is impossible for two independent reasons.** There is only one environment, so there is
nothing to promote _to_; and `deploy-dev.yml` builds and pushes `api:${GITHUB_SHA}` and then deploys
by that **tag**, never capturing the digest. A tag is a mutable pointer — the same argument
ci-gates.md already makes for pinning GitHub Actions to commit SHAs applies verbatim to container
images. **Unblocked by**: a staging or production project (owner), and a small change to capture and
deploy by digest.

**Gate 48 is impossible today** because a canary comparison needs per-revision error-rate and latency
signals, and there is no alerting, no log-based metric, and no release identifier to slice by (gate
4). Cloud Run's built-in `request_count` and `request_latencies` _are_ labelled by revision, so this
is the closest of the impossible gates to being possible: it needs M1 from service-levels.md §3 and
nothing else. **The bake time and the abort threshold must be written down before the first canary**,
not decided while watching one.

## 9. Post-deploy validation

| #   | Gate                                | Command                                                                                    | Evidence                                                                             | Status |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| 51  | Liveness                            | `curl -s <base>/v1/health/live`                                                            | `{"status":"alive","version":"<release>"}` — and the version must be the candidate's | `M`    |
| 52  | Readiness with the database         | `curl -s <base>/v1/health/ready`                                                           | `"status":"ready"` and `database: available`                                         | `M`    |
| 53  | Error envelope is intact            | `curl -s <base>/health/ready` (deliberately without `/v1`)                                 | `404` carrying `error.code`, `correlationId`, `retryable`                            | `M`    |
| 54  | Smoke harness passes                | `VERDERY_BASE_URL=<base> tests/load/run.sh smoke`                                          | All checks pass; `http_req_failed` 0%                                                | `M`    |
| 55  | Web front door serves               | `curl -sI <web base>` and load the root in a browser                                       | `200` and a rendered page                                                            | `M`    |
| 56  | A real authenticated round trip     | Sign in and create, read, and archive a garden on the deployed stack                       | Manual walkthrough note                                                              | `M`    |
| 57  | One request produces one trace      | Cloud Trace shows an HTTP server span with nested `pg-pool` / `pg.connect` children        | Trace id recorded                                                                    | `M`    |
| 58  | Migrations are at the head          | Re-execute the migration job                                                               | `appliedCount: 0`                                                                    | `M`    |
| 59  | Infrastructure matches its scripts  | `infrastructure/gcloud/scripts/verify.sh dev`                                              | All checks pass                                                                      | `M`    |
| 60  | Workers are alive                   | `service.started`, then a sweep heartbeat within its interval                              | —                                                                                    | `X`    |
| 61  | Error budget is not already burning | Compare the trailing window against service-levels.md §5 before declaring the release good | —                                                                                    | `X`    |

**Gate 54 has been run**, against `verdery-dev`, and its output is in load-testing.md §7 — 45/45
checks, `p(95)=84.37 ms`, zero failures. It is the one gate in this document with real evidence
already attached.

**Gate 60 is impossible** because `services/workers` has never been deployed anywhere. Its three
prerequisites are enumerated in deferred-capabilities.md. Until then the outbox never drains, no
media is validated, no derivative is generated, no notification is delivered, and no sweep runs — in
any environment.

**Gate 61 is impossible** because there is no error budget being measured (service-levels.md §2).

## 10. The sixteen impossible gates, and who removes each blocker

| Gate                              | Blocker                                                  | Removed by                                                                                    |
| --------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 4 — release version identifier    | `SERVICE_VERSION` is `0.0.0-development`                 | A build-time stamp in `deploy-dev.yml`. Small, mechanical.                                    |
| 16 — native device E2E            | No device, no simulator, no TestFlight build             | **Owner** — Apple Developer account actions (ios-distribution.md)                             |
| 21 — migration rehearsal at scale | No production-shaped dataset                             | Staging environment (**owner**) + gate 24                                                     |
| 24 — restore performed            | Never attempted                                          | **Owner** approval for one non-destructive restore to a scratch instance                      |
| 25 — restore timed / RTO          | Follows gate 24                                          | Gate 24                                                                                       |
| 26 — PITR verified                | Follows gate 24                                          | Gate 24                                                                                       |
| 27 — post-restore verification    | Follows gate 24                                          | Gate 24                                                                                       |
| 29 — signed mitigation register   | Signature is a human act                                 | **Owner**                                                                                     |
| 36 — image vulnerability scan     | Scanning never enabled; no CI gate                       | **Owner** (enable) + a CI check                                                               |
| 38 — edge enforcement live        | No load balancer, no Cloud Armor; App Check monitor-only | **P8-NET-01**, then **P8-SEC-02**                                                             |
| 43 — link checking                | No tool                                                  | Anyone. Cheapest item in this document.                                                       |
| 46 — promote the same artifact    | One environment; deploys by mutable tag, not digest      | **Owner** (staging/production) + a digest change                                              |
| 48 — canary compared to SLOs      | No metrics, no release identifier                        | service-levels.md §3 M1, plus gate 4                                                          |
| 50 — production promotion         | No production project                                    | **Owner**                                                                                     |
| 60 — workers alive                | `services/workers` never deployed                        | The three prerequisites in deferred-capabilities.md, then a live deploy (**owner-confirmed**) |
| 61 — error budget healthy         | No budget is measured                                    | service-levels.md §3 M1–M7                                                                    |

Three of these — 24, 4, and 43 — are small, cheap, and unlock a disproportionate share of the rest.
If only one thing is done before the next release attempt, it should be **gate 24: perform a
restore**.

## 11. Exit criteria mapped to gates

implementation-plan.md §17.3's eight exit criteria, against the gates that would evidence each.

| Exit criterion                                                                                                            | Gates            | Reachable today?                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| Acceptance outcomes pass on supported native and web surfaces                                                             | 15, 16, 56       | **No** — gate 16                                                     |
| Production database, storage, ingress, identities, queues, backups, dashboards, budgets, alerts, runbooks meet thresholds | 23–27, 38, 59–61 | **No** — no production project, no dashboards, no budgets, no alerts |
| Export is private and machine-readable; deletion reaches all systems                                                      | 9, 30            | **Partly** — suites pass; end-to-end needs workers (gate 60)         |
| Cross-garden, offline replay, malicious upload, web session, AI boundary tests pass                                       | 30–34            | **Yes**                                                              |
| English/Russian localization and accessibility matrix pass                                                                | P8-UX-01         | **No** — needs real devices                                          |
| Restore and rollback are timed and rehearsed                                                                              | 24, 25, 49       | **No** — gate 24                                                     |
| Documentation matches the release candidate                                                                               | 39–44            | **Yes**, once run                                                    |
| G8 approved; the same immutable artifacts promoted to production                                                          | 29, 45, 46, 50   | **No** — no production project                                       |

**Two of eight are reachable today.** That is the honest state of G8, and stating it is more useful
than a checklist that implies otherwise.

## 12. Sign-off

The signature block belongs with the run, not with the template. When a release candidate is
actually gated, record: the candidate SHA, the image digest, the date, each gate's status and
evidence pointer, every gate deliberately waived and why, and the owner's signature on gate 29's
mitigation register. A checklist signed with impossible gates left unmarked is worse than no
checklist, because it converts a known gap into a claimed pass.
