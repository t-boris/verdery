# Support operations — DESIGN

> Work package: P8-SUPPORT-01, buildable half
> Status: **DESIGN. No inbox, no rota, and no support-access mechanism exist.**
> Drafted against the repository as of July 25, 2026

## 1. What this document is

P8-SUPPORT-01 is "**Establish** support intake, incident severity, privacy-safe diagnostic
collection, feature-disable controls, and escalation ownership". Establishing an intake means a real
address a real person watches, and establishing escalation ownership means naming people. Both are
owner gates.

What can be delivered without them is the design: the severity ladder, the triage flow, the rules
for what diagnostic data may be collected, an honest account of which feature-disable controls exist
today and which do not, and — the largest item — a specification of the support-access mechanism
that **does not exist at all**.

That last point is not a caveat. [threat-model.md](threat-model.md) §14 states it plainly:

> **The honest finding: no support-access mechanism exists.** There is no administrative role, no
> impersonation, no support-session concept, no time-limited elevation, and no admin surface of any
> kind in `services/api`, `apps/web`, or `apps/ios`. security-and-privacy.md commits to support
> access that is "time-limited and audited" (sections 6, 18, 21); today the only way to answer a
> support question about a user's data is a direct, unaudited database session by whoever holds the
> credentials. That is not a bypass of a control — it is the absence of one.

Section 6 of this document specifies what would have to be built. Until it is, section 5's rules are
the only thing standing between a support question and an unaudited `psql` session, and rules
without mechanisms are exactly as strong as the person following them.

## 2. Severity

Severity is assigned from **user impact and SLO burn**, not from how loud the reporter is. Each
level names the [service-levels.md](service-levels.md) signal that defines it, so severity is a
lookup rather than a judgment call at 03:00.

| Level     | Definition                                                                                                                                                                                                                                                       | Acknowledge     | Target resolution               | Who is woken                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------- | -------------------------------- |
| **SEV-1** | Data loss, data exposure, or total unavailability. Any of: a cross-garden authorization failure (RB-06); a credential compromise (RB-05); a deletion that reported success without deleting (SLI-8, which has **no** error budget); SLI-1 failing for all users. | 15 min          | Continuous work until mitigated | Primary, immediately, any hour   |
| **SEV-2** | A core workflow is broken for all users, or an SLO is on **fast burn** (14.4×, 2% of budget in one hour). Sync push failing wholesale; Today returning errors; uploads never completing; the media pipeline stalled beyond SLI-7.                                | 1 hour          | 8 hours                         | Primary, working hours or sooner |
| **SEV-3** | Degraded but usable, or an SLO on **medium burn** (6×). Elevated latency inside the p99 bound; one rule producing wrong recommendations; notifications late beyond SLI-9; a sweep not running.                                                                   | 1 business day  | 5 business days                 | Nobody. Ticket.                  |
| **SEV-4** | Single-user or cosmetic. One account's data looks wrong; a layout defect; a confusing message.                                                                                                                                                                   | 2 business days | Next release cycle              | Nobody.                          |
| **SEV-5** | Question, feature request, or "how do I".                                                                                                                                                                                                                        | 3 business days | —                               | Nobody.                          |

### 2.1 Two classifications that override the ladder

- **Privacy incident.** Any report suggesting one user could see another user's data, that deleted
  data still exists, that an export contained something it should not, or that a signed URL leaked
  is **SEV-1 regardless of how many users are affected**. One is enough. It routes to the security
  owner and to RB-06 or RB-07, and the evidence-preservation step happens _before_ any remediation.
- **Safety report.** A recommendation that could damage a plant, a structure, or a person is
  **SEV-2 minimum**, routes to the horticultural reviewer, and is handled through
  [recommendation-safety-catalog.md](recommendation-safety-catalog.md)'s own escalation, not through
  this ladder. The disable path is section 4's AI kill-switch if the item was AI-embellished, and a
  rule change otherwise.

### 2.2 The honest note on response times

Every number above assumes someone is watching. Today there is **no alerting of any kind** — no
notification channels, no alert policies, no log-based metrics in any project (runbooks.md §1.5) —
and one operator with no secondary (service-levels.md §9). A 15-minute SEV-1 acknowledgement is
therefore a target that depends entirely on a human noticing, and the realistic worst case is "next
morning". This is the same arithmetic behind the proposed 99.5% availability target, and the two
should be approved or rejected together.

## 3. Intake and triage

### 3.1 Intake channels — none of which exist yet

| Channel                    | Purpose                                            | Status                                                                                                                                    |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Support email alias        | The single front door for users                    | **Does not exist.** Owner action: create the address and decide who reads it.                                                             |
| In-app "report a problem"  | Attaches diagnostic context automatically          | **Does not exist** on web or iOS. Needs a client feature; no work package owns it.                                                        |
| App Store review responses | Apple's channel; mandatory to watch once published | Owner action, tied to P8-STORE-01.                                                                                                        |
| Security disclosure        | A separate address for vulnerability reports       | **Does not exist.** Should not share the general inbox — a report of a cross-garden read must not queue behind a password-reset question. |

Every channel must reach one queue with one triage owner. Two inboxes with no owner is worse than
one.

### 3.2 What a report must capture

Ordered by how much triage time each field saves. Nothing here is user data.

| Field                            | Why                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correlation id**               | The single most valuable field. Every response carries `x-correlation-id`, and every error envelope carries `error.correlationId`. It is the join key into every log line for that request. Ask for it first. |
| Timestamp with time zone         | Bounds the log query. Every `gcloud logging read` in the runbooks uses `--freshness`; an unbounded query can block for minutes.                                                                               |
| Error code                       | The envelope's stable dotted `error.code`, e.g. `sync.changes.cursor_expired`. Maps directly to a code path.                                                                                                  |
| `error.retryable`                | Tells triage immediately whether the failure was classified as transient.                                                                                                                                     |
| Surface and version              | Web or iOS, and the build. `SERVICE_VERSION` is `0.0.0-development` today, so the server half of this is not yet useful — see service-levels.md §3, M6.                                                       |
| What was expected, what happened | Ordinary bug-report content.                                                                                                                                                                                  |
| Reproducibility                  | Once, sometimes, always.                                                                                                                                                                                      |

**Never requested, and refused if volunteered:** passwords, ID tokens, session cookies, signed URLs,
screenshots showing another person's data, or exported archives. A support process that accepts a
credential has created the incident it was trying to diagnose.

### 3.3 Triage flow

1. **Classify** against section 2. When two levels seem to fit, take the higher one — de-escalating
   later is cheap.
2. **Check for a known cause before investigating.** Several routine conditions look like defects:
   - every PDF `imported_plan` fails validation retryably **by design** while no malware provider is
     selected;
   - the weather sweep degrades with `noProviderConfigured` for every garden, because zero providers
     are registered;
   - recommendation explanations are never AI-embellished, because the kill-switch is off;
   - **no outbox event is ever published in `verdery-dev`, because `services/workers` is not
     deployed** — so nothing is validated, no derivative is generated, no notification is delivered,
     and no sweep runs. This single fact explains a large share of "it never finished" reports and
     must be the second thing triage checks.
3. **Correlate.** Query with the correlation id. Runbooks.md §1.7 documents the exact log shape and
   the standing warning to bound every query with `--limit` and `--freshness`.
4. **Route** by section 7's table.
5. **Decide on a disable.** If a feature is actively harming users, section 4 says what can and
   cannot be turned off, and what turning it off costs.
6. **Record** the outcome. There is no ticket system; until one exists, the outcome belongs wherever
   the runbook exercise log lives, so recurring causes are visible.

## 4. Feature-disable controls

### 4.1 The constraint that shapes all of them

**Configuration is validated once at startup and never re-read per request**
(`platform/configuration/configuration-schema.ts`: "an invalid deployment fails immediately instead
of failing on the first request that happens to need the bad value"). There is no dynamic
configuration, no remote config, and no feature-flag service.

**Therefore every switch below is a redeploy.** On Cloud Run that means
`gcloud run services update --update-env-vars=...`, which creates a new revision and shifts traffic
— minutes, not seconds, and it restarts the service. This is a deliberate design property with a
real operational cost, and any incident plan that assumes a flag flip is instant is wrong.

### 4.2 What exists today

| Control                         | Mechanism                                                                                                                                                                                                                                                                                                                                                                          | Cost to flip                       | Granularity             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| **AI explanation kill-switch**  | `RECOMMENDATION_AI_EXPLANATION_ENABLED=false`. Genuinely structural, not a runtime branch: no GenAI client is constructed, the sweep's embellishment phase does not exist, and the Today read path never touches the verdict table. Behaviour returns exactly to the pre-P7-AI-01 baseline, and the model/prompt versions stored on every record are what makes a flip comparable. | API redeploy                       | All users, all gardens  |
| **Weather provider**            | Unset `WEATHER_ACTIVE_PROVIDER_KEY` → typed `noProviderConfigured` degradation, never an exception. Rules that need weather record a typed `ruleSkips` reason instead of producing a wrong recommendation.                                                                                                                                                                         | API redeploy                       | All users               |
| **Any provider, by exhaustion** | `integrations.provider_quota_usage` consumes hourly and daily budget atomically **before** each call. Setting a provider's limits to a spent value stops calls without a code change.                                                                                                                                                                                              | Depends on where limits are stored | Per provider            |
| **AI call budget**              | `RECOMMENDATION_AI_MAX_CALLS_PER_HOUR` / `_PER_DAY` (defaults 50 / 500). A softer version of the kill-switch: caps spend rather than stopping the feature.                                                                                                                                                                                                                         | API redeploy                       | All users               |
| **Sweep cadence**               | `MEDIA_RETENTION_SWEEP_INTERVAL_MS`, `WEATHER_REFRESH_SWEEP_INTERVAL_MS`, `RECOMMENDATION_EVALUATION_SWEEP_INTERVAL_MS`, `NOTIFICATION_DELIVERY_SWEEP_INTERVAL_MS`, `DELETION_SWEEP_INTERVAL_MS` — all worker env vars, all slowable.                                                                                                                                              | Worker redeploy                    | Per sweep               |
| **Stop all background work**    | Scale the workers service to zero instances. Blunt but complete: the relay, all five sweeps, and the media pipeline stop together. Nothing is lost — every sweep drains what it finds when it restarts — but nothing progresses.                                                                                                                                                   | One `gcloud run services update`   | Everything asynchronous |
| **Revert the whole service**    | `gcloud run services update-traffic --to-revisions=<previous>=100`. The coarsest and fastest control, and the only one that needs no configuration knowledge. RB-01.                                                                                                                                                                                                               | Seconds                            | Everything              |
| **Export concurrency**          | One active export per requester, pre-checked and enforced by a partial unique index. Already on; not a switch.                                                                                                                                                                                                                                                                     | —                                  | Per requester           |

### 4.3 What does not exist, and would have to be built

| Missing control             | Why it matters                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-feature flags**       | There is no way to disable media upload, synchronization, notifications, export, or deletion independently. If uploads are corrupting data, the only options are "revert the whole service" or "let it continue".                                                                                                                                       |
| **Maintenance mode**        | No read-only mode and no "we are working on it" state. The nearest equivalent is returning `503` from readiness, which makes Cloud Run stop routing entirely — an outage, not a maintenance window.                                                                                                                                                     |
| **A rate limit to turn up** | There is **no rate limiting anywhere** (`T-COST-01`, `-02`, `-05`, `-10`). Under abuse there is nothing to tighten. `@fastify/under-pressure` sheds load at a 1000 ms event-loop delay, which protects the process, not the users.                                                                                                                      |
| **Per-user suspension**     | `account_state` can reach `deletion_requested` or `disabled`, and `isAccountUsable` gates every request on it — but those states mean "being deleted", not "suspended". Using them for abuse handling would tell the user their account is being deleted, and would start a 30-day purge clock. **Do not do this.** A real suspension state is missing. |
| **App Check enforcement**   | App Check classifies and logs, never rejects, and only on authenticated routes. Flipping it to enforce is P8-SEC-02 and needs beta telemetry that does not exist.                                                                                                                                                                                       |
| **Client-side kill switch** | No way to tell a shipped iOS build to stop doing something. The only lever is a server response, and there is no version-gating mechanism.                                                                                                                                                                                                              |

## 5. Privacy-safe diagnostics

### 5.1 What may be collected without touching user data

The correlation id is the whole design. Every request carries one — validated against
`/^[A-Za-z0-9._-]{1,128}$/` when the client supplies it, otherwise generated — bound into the
request logger and echoed on the response. From it, a support operator gets, with no access to user
content at all:

`service`, `level`, `severity`, `msg`, `reqId`, `correlationId`, `traceId`, `spanId`, `environment`,
`version`, `res.statusCode`, `responseTime`, plus whichever structured `event` the request emitted
(`sync.push.completed` with its outcome counts, `media.upload.completed` with its class and timing,
`recommendations.today_served` with its item counts, and so on).

Those events are counts, classes, ids, durations, and typed reasons — never payloads. That is
deliberate: observability-and-analytics.md §6 prohibits it, and the logger enforces part of it
mechanically by **removing** (not masking) `authorization`, `cookie`, `x-firebase-appcheck`,
`proxy-authorization`, `set-cookie`, `databaseUrl`, `password`, `token`, `secret`, and `signedUrl`.

**This resolves the large majority of support questions.** "My upload never finished" is answered by
`media.upload.registered` with no matching `media.upload.completed`. "Today is empty" is answered by
`recommendations.today_served` with `itemsServed: 0`. Neither needs a single row of the user's data.

### 5.2 What must never be collected

Garden names, notes, plant identities, exact geometry, coordinates, media bytes, filenames, object
keys, signed URLs, tokens, cookies, recipient identities, FCM tokens, prompt or model response text.
The prohibition is architectural, not a policy anyone applies by hand — the log statements were
written not to carry them.

### 5.3 The gap: everything above stops at the request boundary

Some questions are genuinely about the user's data — "my garden lost a bed", "the export is missing
photos". Answering those means reading the database, and here the design ends and the honest gap
begins:

- There is **no support read surface**. No admin API, no admin UI, no scoped query tool.
- There is **no audit of audit reads** (`T-SUPPORT-04`): "there is no audit read surface at all, so
  there is also nothing to audit."
- `platform.audit_event` is a **database table, not a Cloud Logging stream**. Even the audit trail
  requires SQL, which requires the very access this section is about.
- The `exports` module writes **no audit event at all** (`T-SUPPORT-05`) — the single
  highest-value data-egress operation in the product leaves no audit row, while its sibling media
  and gardens modules both do. threat-model.md §16.2 has an apply-ready fix for this.
- The break-glass path (`07-iam-database-bootstrap.sh`) rotates the superuser password behind an
  explicit confirmation and self-reverts, but writes **nothing** to `platform.audit_event`
  (`T-SUPPORT-02`).

So today the answer to "how do we look at a user's data for support?" is: **a direct database
session by whoever holds the credentials, with no scope, no expiry, and no record**.

### 5.4 The interim rule, and its honest weakness

Until section 6 is built, any database access for support purposes must:

1. be requested by the user in writing, for their own account only;
2. be preceded by a written note — what is being looked at, why, and under which ticket — kept
   wherever the runbook exercise log is kept;
3. be **read-only** (`SELECT` only; never an `UPDATE` to "fix" a user's row — that destroys the
   revision and audit history the product depends on);
4. read the minimum: prefer counts, states, and timestamps over content;
5. be recorded afterwards with what was actually read.

**This is process, not a control.** Nothing enforces any of the five, and a person under pressure at
03:00 is exactly who they are designed to constrain. That is the argument for section 6.

## 6. The support-access mechanism that must be built

Specification, not implementation. Sized so it is a small piece of work rather than a platform.

### 6.1 The schema already anticipates it

`platform.audit_event` constrains `actor_type` to `('user', 'system', 'administrator')`. The
`administrator` value **has no producer anywhere in the codebase** — the schema was written for a
support actor that was never built. That is the seam to build into: an audited support action is
already representable, and needs no migration to the audit table.

### 6.2 What to add

1. **A `support_session` record.** `id`, `operatorProfileId`, `subjectType`
   (`profile` | `garden`), `subjectId`, `reason` (free text, required), `ticketReference`,
   `grantedAt`, `expiresAt`, `revokedAt`. Created only under **recent authentication** — the
   `DELETION_RECENT_AUTHENTICATION_MAX_AGE_MS = 30 minutes` gate that account deletion and export
   already use is the right precedent and the right constant to reuse.
2. **A time box.** `PROPOSED` **4 hours**, non-extendable — a second session must be opened, with a
   second reason, which is the point. Derived from being long enough for one support interaction and
   far shorter than a working day.
3. **Read-only scope, enforced in the capability layer.** Support access grants `viewGarden`-class
   reads and **nothing** that mutates. `requireCapability` is already the single place every route
   passes through, so this is an additional actor kind rather than a parallel authorization path.
4. **`restricted` media stays out of scope.** Media with `sensitivityClassification: 'restricted'`
   already audits every access grant with the reader's role; support access must be excluded from it
   entirely rather than audited into it.
5. **Every read audits.** One `platform.audit_event` row per support read, `actor_type:
'administrator'`, with the session id in `details`. This closes `T-SUPPORT-01` and, because the
   support surface is itself the audit read surface, `T-SUPPORT-04`.
6. **The user is told.** A notification intent on session open, through the P7 pipeline that already
   exists. Support access the user cannot see is indistinguishable from a breach.

### 6.3 Two small fixes that should land first

Both are already specified elsewhere and are worth more per line than anything above:

- **Audit the export request** — threat-model.md §16.2, apply-ready. Data egress with no audit row
  is the widest hole in the current trail.
- **Audit the break-glass path** — write a `platform.audit_event` row when
  `07-iam-database-bootstrap.sh` performs its privileged actions (`T-SUPPORT-02`).

## 7. Escalation ownership

Roles, per service-levels.md §9. **One person holds all of them today.**

| Report type                                       | First responder        | Escalates to          | Runbook                          |
| ------------------------------------------------- | ---------------------- | --------------------- | -------------------------------- |
| Service down, errors for everyone                 | Primary on-call        | Service owner         | RB-01, RB-02                     |
| Cross-garden data visible / authorization failure | Security owner         | Service owner (SEV-1) | RB-06                            |
| Deleted data still present, or export leaked      | Data and privacy owner | Security owner        | RB-07                            |
| Credential or key exposure                        | Security owner         | Service owner (SEV-1) | RB-05                            |
| Uploads stuck, processing never completes         | Primary on-call        | —                     | P6-OBS-01 runbook entries        |
| Notifications missing or late                     | Primary on-call        | —                     | P7 delivery-sweep signals        |
| Recommendation is wrong or unsafe                 | Horticultural reviewer | Service owner         | recommendation-safety-catalog.md |
| Unexpected bill                                   | Cost owner             | Service owner         | RB-08                            |
| Account or billing question                       | Support owner          | —                     | —                                |

**Gaps in this table that are not editorial.** There is no secondary on-call, so every "escalates
to" column resolves to the same person as the first responder. There is no support owner, so the
last row has no responder at all. And there is no paging mechanism: escalation today means one
person noticing.

## 8. What establishment requires

The owner gates, listed so the buildable half is not mistaken for the whole:

| Gate                                                                  | Owner               |
| --------------------------------------------------------------------- | ------------------- |
| A support address, and a separate security-disclosure address         | Owner               |
| A person who reads them, and their hours                              | Owner               |
| A second responder, or an explicit acceptance of single-operator risk | Owner               |
| A ticket system, or an explicit decision to track in the repository   | Owner               |
| The published support link required for App Store submission          | Owner (P8-STORE-01) |
| The support-access disclosure in the privacy notice                   | Owner (P8-PRIV-01)  |
| Approval to build section 6                                           | Owner               |

Section 6 is the one item on this list that is engineering work rather than a decision, and it is
the one that turns section 5.4's process into a control.
