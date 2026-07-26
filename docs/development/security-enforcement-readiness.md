# Security enforcement readiness (P8-SEC-02)

**Status: the switches are built, tested, and OFF. Nothing in this document has been flipped.**

`P8-SEC-02` reads: _"Move CSP and selected Cloud Armor rules from observe to enforce; enforce App
Check on validated expensive endpoints; complete IAM and secret reviews."_ Two of those three are
blocked on things that do not exist yet, and this document is explicit about which:

| Half of the package           | State                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP report-only → enforce     | **Buildable and built.** The policy is corrected, reporting is real, and an enforcing browser run proves it. The mode is a configuration value defaulting to report-only. |
| Cloud Armor observe → enforce | **Not buildable.** `infrastructure/gcloud/scripts/12-cloud-armor.sh` is written; there is no load balancer to attach it to. Blocked on `P8-NET-01` being applied.         |
| App Check monitor → enforce   | **Buildable and built.** Enforcement exists as a configuration switch defaulting to `monitor`, with both positions tested. The flip itself needs beta telemetry.          |
| IAM and secret reviews        | **Buildable and done.** Section 3 below is the review.                                                                                                                    |

The two flips are deliberately left to an operator with data in hand. What this package removed is
every reason a flip would have to be a code change made under time pressure.

---

## 1. The Content Security Policy

### 1.1 What the previous policy would have broken

`threat-model.md` section 16.4 recorded two claims about the report-only policy that shipped before
this package. Both were checked against what the application actually does at runtime, and both
hold. The policy, verbatim:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Enforced as written, on the deployed application, this breaks the following. Each row names the file
that makes the request, which is how the claim was established — by tracing every outbound call in
`apps/web` to its origin, not by reasoning about what a Next.js app usually needs.

| What breaks                              | Blocked by                                   | Origin the code actually contacts                                                                              | Evidence in the codebase                                                                   |
| ---------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Sign-in (all three methods)**          | `connect-src 'self'`                         | `https://identitytoolkit.googleapis.com`                                                                       | `core/auth/sign-in.ts` — `signInWithPopup`, `sendSignInLinkToEmail`, `signInWithEmailLink` |
| **Google / Apple sign-in specifically**  | no `frame-src` at all → `default-src 'self'` | `https://<NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN>` — `signInWithPopup` installs a hidden iframe at `/__/auth/iframe` | `core/auth/sign-in.ts`, `core/auth/firebase-app.ts` (`authDomain`)                         |
| **Every session, ~1 hour after sign-in** | `connect-src 'self'`                         | `https://securetoken.googleapis.com` (ID-token refresh)                                                        | `firebase/auth` internals, reached from `core/auth/firebase-app.ts`                        |
| **App Check attestation**                | `connect-src 'self'`                         | `https://firebaseappcheck.googleapis.com`                                                                      | `core/auth/app-check.ts`                                                                   |
| **App Check's reCAPTCHA provider**       | `script-src 'self'`                          | `https://www.google.com/recaptcha/enterprise.js`, which loads from `https://www.gstatic.com`                   | `core/auth/app-check.ts` — `ReCaptchaEnterpriseProvider`                                   |
| **Media upload (every byte)**            | `connect-src 'self'`                         | `https://storage.googleapis.com` — the resumable PUT goes browser→GCS directly, never through the API          | `features/media/gcs-resumable-transport.ts`, `features/media/resumable-upload-driver.ts`   |
| **Media display**                        | `img-src` without the storage host           | `https://storage.googleapis.com` — the signed URL `GetMediaAccess` returns                                     | `features/media/media-preview.tsx` ("the source is a short-lived signed URL")              |
| **The map, entirely**                    | `connect-src 'self'`                         | `https://tiles.openfreemap.org` — style JSON, vector tiles, glyphs, sprites                                    | `features/map/basemap-provider.ts`                                                         |
| **The map, a second way**                | no `worker-src` → `default-src 'self'`       | `blob:` — MapLibre GL 6 builds its worker with `new Worker(URL.createObjectURL(blob))`                         | `node_modules/maplibre-gl/dist/maplibre-gl.mjs`, confirmed by grep for `createObjectURL`   |

And the finding that matters most is not in the table, because it is not a breakage:

> `script-src 'self' 'unsafe-inline'` means the directive that exists to stop injected inline script
> **allowed injected inline script**. Enforcing that policy would have produced the appearance of a
> control and none of the substance. `threat-model.md` 16.4 says the same thing in one line: "needs
> a nonce before enforcement is meaningful."

The second recorded fact also holds: the policy declared **no `report-uri` and no `report-to`**, so
in three months of "monitoring" nothing was ever collected. Report-only was true of the mode and
false of the practice.

### 1.2 How the claims were proved rather than asserted

Three ways, in increasing order of how much they are worth:

1. **Static trace.** Every `https://` literal in `apps/web` was enumerated and attributed. That
   produced the origin list above and, importantly, produced no origins that are _not_ on it — the
   application contacts exactly seven external hosts.
2. **Build-shape check.** A per-request nonce is only safe if no route is prerendered with a stale
   one baked in. `next build` reports **every route as `ƒ (Dynamic)`**, because the root layout
   negotiates locale from request headers (`shared/localization/server.ts`). That is the
   precondition, and it was verified rather than assumed.
3. **A real browser, with the policy enforced.** `apps/web/e2e/content-security-policy.spec.ts`
   loads every route the harness can reach, listens for `securitypolicyviolation`, and fails with
   the exact directive and blocked URI. `e2e/run-e2e.sh` sets `WEB_CSP_MODE=enforce`, so **the
   entire E2E suite** — sign-in, the map, the care loop, keyboard, responsive, accessibility — runs
   against an enforcing policy. Under enforcement a missing directive is not a warning; it is a
   failing test.

**What the browser run actually found.** Three defects, none of which static analysis could have
surfaced, and two of which would have broken the deployed product. This is the argument for running
a browser against an enforcing policy rather than reviewing a policy string:

1. **App Check's browser SDK calls `https://content-firebaseappcheck.googleapis.com`, not
   `https://firebaseappcheck.googleapis.com`.** The `content-` prefixed host is what
   `exchangeRecaptchaEnterpriseToken` actually goes to. Naming the documented host alone blocked
   **every attestation on every one of the nine routes** — and it did so _silently_, because App
   Check failure is a soft signal by design (`core/api/client.ts` treats it as monitor-only). The
   symptom would have been App Check quietly reporting `missing` for 100% of real web traffic, which
   is the exact signal section 2 asks an operator to base the App Check flip on. One wrong hostname
   would have corrupted the input to the other half of this work package.
2. **`signInWithPopup` loads `https://apis.google.com/js/api.js`.** Firebase Auth injects the Google
   API loader to build its auth iframe. Without that origin in `script-src`, Google and Apple
   sign-in fail on the real site with nothing in the UI but "Sign-in did not succeed. Try again."
   This is a production path, not a harness artefact, and it is the single most consequential thing
   this run found.
3. **`frame-src` needed the Auth emulator origin** in the harness configuration:
   `connectAuthEmulator` redirects the auth iframe away from the real auth domain. Affects the E2E
   configuration only — the deployed policy names the real domain, which is correct.

All three are now named in `CSP_ORIGINS` with the reason attached, and each is pinned by a unit test
so it cannot be dropped by a future "simplification".

Separately, and found by tests rather than the browser: **a defect in the CSP report handler**.
`new URL('javascript:alert(1)//')` parses and yields a `pathname` of `alert(1)//`, which would have
written attacker-authored text into a log line. See section 1.4.

**What it did not find, which is also a result.** Every route rendered, the map worker started, the
care loop ran, the magic-link sign-in completed, and the accessibility and responsive audits passed
— all with the policy enforced.

### 1.3 The corrected policy

Built per request by `apps/web/shared/security/content-security-policy.ts`, applied by
`apps/web/proxy.ts`. In the deployed configuration it is:

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' https://www.google.com https://www.gstatic.com
            https://apis.google.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://storage.googleapis.com https://tiles.openfreemap.org;
font-src 'self';
connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com
            https://content-firebaseappcheck.googleapis.com https://firebaseappcheck.googleapis.com
            https://storage.googleapis.com https://tiles.openfreemap.org https://www.google.com;
worker-src 'self' blob:;
frame-src https://<auth-domain> https://www.google.com;
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
report-uri /internal/csp-report; report-to csp
```

The decisions inside it that are not obvious:

- **A nonce, not `'unsafe-inline'`, and not `'strict-dynamic'`.** The nonce is what makes
  enforcement worth doing at all. `'strict-dynamic'` was considered and rejected: it would let any
  script this page trusts load any other script, which is a broader grant than naming the two
  origins reCAPTCHA actually uses. Next.js reads the nonce back out of the request's CSP header and
  stamps it on its own inline bootstrap — verified: **19 of 19 `<script>` tags on `/auth/sign-in`
  carry it.**
- **`'unsafe-inline'` stays in `style-src`, and that is not an inconsistency.** React renders the
  `style` prop as an inline `style="..."` _attribute_, and a nonce cannot apply to an attribute —
  only to a `<style>` element. Removing it would mean eliminating every inline style in the
  application, including the ones MapLibre and react-konva set on canvases they own. The residual
  risk is CSS injection: real, and a category weaker than script injection. Recorded rather than
  pretended away.
- **The exact auth domain, not `https://*.firebaseapp.com`.** Wildcarding would admit every Firebase
  project on the internet as a framing source, for no benefit.
- **`worker-src 'self' blob:` stated explicitly.** `worker-src` falls back to `child-src` and then
  `default-src`; inheriting `'self'` is exactly the failure that kills the map silently.
- **No API host in the deployed policy.** `NEXT_PUBLIC_API_ORIGIN=same-origin` means `/v1/*` is
  proxied by the web server itself, so `'self'` covers it. The policy names a cross-origin API host
  only in local development and the E2E harness, where the browser genuinely calls one.
- **`'unsafe-eval'` and `ws:` exist only under `next dev`**, for React Refresh and hot reload. A
  production build never takes that branch, and both unit tests and the E2E pin the delta.

### 1.4 The reporting endpoint decision

**First-party, into this application's own logs.** `apps/web/app/internal/csp-report/route.ts`
accepts both wire shapes (`application/csp-report` for `report-uri`, `application/reports+json` for
`report-to`) and emits one structured line per violation. On Cloud Run, stdout is Cloud Logging,
which is where every other operational signal in this system already goes.

A hosted collector (report-uri.com and similar) was considered and rejected. It would have meant a
new vendor, a new outbound flow carrying URLs out of real users' sessions to a third party, and —
by this project's own rule in security-and-privacy.md section 23 — a threat-model review for a new
provider, to solve a problem a log line on an already-aggregated server solves for nothing.

**Both `report-uri` and `report-to` are emitted.** `report-uri` is formally deprecated but is still
the only mechanism Safari and Firefox implement; `report-to` is what Chrome honors. Emitting one
would mean collecting from some of the browsers in `package.json`'s browserslist and not others.
The `Reporting-Endpoints` response header is set alongside, because without the group declaration
Chrome discards `report-to` reports silently — which would have recreated the exact "declared but
collecting nothing" state this work exists to end.

**What is deliberately not recorded.** A violation report is attacker-influenceable data on an
unauthenticated endpoint, and in this application two of its fields can carry credentials: the
email-link sign-in URL's `oobCode` _is_ the credential, and a signed Cloud Storage URL is a bearer
credential for its TTL (`T-SIGN-09`). So the handler records the document **path** only (never the
query), the blocked **origin** only (never the path or query), and never the script sample — which
by design contains a fragment of the offending code and therefore potentially of the page's own
data. Every field is length-bounded.

Writing the tests for this found a real defect in the first version: `new URL('javascript:alert(1)//')`
parses happily and yields a `pathname` of `alert(1)//`, which would have put attacker-authored text
straight into a log line. Both URL reducers now check the scheme, and `blocked-uri` keeps only
values that are either a CSP keyword from a fixed allowlist or a parseable `http(s)` URL.

### 1.5 New public surface — a threat-model addendum is owed

`POST /internal/csp-report` is a **new unauthenticated public endpoint**. Per `threat-model.md`
section 17 ("What invalidates a signature"), a new public endpoint is a new threat-model review.
This document cannot edit that register, so the row is stated here for whoever does:

> **`T-CSP-01`** — The CSP violation sink is an unauthenticated endpoint that causes a log write.
> **State:** partially mitigated. Per-request cost is bounded (8 KiB body cap, content-type
> allowlist, one bounded log line, no database access, no dependencies). Per-caller rate is **not**
> bounded — it is subject to `T-COST-01` exactly like every other endpoint in this system, and is
> closed by `P8-NET-01`'s edge rather than in application code. Content is reduced before logging
> (section 1.4). **Owner:** `P8-NET-01`.

### 1.6 Flipping it, and rolling back

The switch is `WEB_CSP_MODE`, read server-side by `apps/web/proxy.ts`.

- Absent, or anything other than the exact string `enforce` → `Content-Security-Policy-Report-Only`.
  A typo fails **safe**, toward not breaking the product: accidental enforcement is a blank page for
  every user, while accidental report-only is the status quo.
- `enforce` → `Content-Security-Policy`.

**The policy string is byte-identical in both modes.** Only the header name changes. That is what
makes the enforcing E2E run evidence about the report-only policy too.

**Verified as a runtime change, not a rebuild.** The same production build was started twice, once
without the variable and once with `WEB_CSP_MODE=enforce`, and served the report-only and enforcing
header names respectively. So the flip is `gcloud run services update --update-env-vars`, and the
rollback is `--remove-env-vars`, on the existing image.

**Suggested order.** Deploy report-only (already the case) → watch `event: "csp.violation"` in Cloud
Logging across real traffic for a beta cycle → flip → watch the same query, where `disposition` now
reads `enforce` on anything actually blocked → roll back on any violation that is not an attack.

---

## 2. App Check enforcement

### 2.1 What was monitor-only, and what changed

`platform/app-check/app-check-plugin.ts` classified every request and logged the result, on the
authenticated routes only. It still does exactly that by default. Three things are new:

1. **The enforced-endpoint list exists**, in code, reviewed and test-pinned
   (`platform/app-check/app-check-enforcement.ts`).
2. **The switch exists**, in configuration, defaulting to off (`APP_CHECK_ENFORCEMENT=monitor`).
3. **Monitor mode now produces the telemetry the flip has been blocked on.** Every classification
   log line carries `enforced`, `mode`, and `outcome`, where `outcome: "wouldReject"` means _this
   request succeeded, and enforcement would have refused it_. That number did not exist before, and
   it is produced by the same code path enforcement will use — so it describes the real rule rather
   than an approximation of it.

### 2.2 The validated expensive endpoints

"Expensive" here means the register's own definition: one cheap-to-issue request causes work or
storage that is billed. Five endpoints qualify.

| Endpoint                                             | Register row       | Why                                                                                                                                              |
| ---------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/auth/session`                              | `T-COST-02`        | The most expensive **unauthenticated** endpoint in the product: each call costs a Firebase `verifyIdToken` **and** a `createSessionCookie`.      |
| `POST /v1/gardens/:gardenId/media`                   | `T-COST-03`, `-04` | Registration reserves storage and opens a resumable upload session. No numeric ceiling exists anywhere, so the only available bound is on _who_. |
| `POST /v1/gardens/:gardenId/media/:mediaId/complete` | `T-COST-04`        | Completion is what actually enqueues processing. Enforcing registration alone leaves the fan-out reachable by replaying a held session id.       |
| `POST /v1/exports`                                   | `T-COST-06`        | Highest-cost per-user operation and highest-value data egress. Already has the codebase's only real per-user rate limit, so this is depth.       |
| `GET /v1/gardens/:gardenId/today`                    | `T-COST-07`, `-10` | The evaluation surface: it serves recommendation output and, with the AI kill-switch on, consumes the provider call budget.                      |

**Deliberately not enforced**, recorded so the omissions are decisions:

- Every `/v1/internal/*` route — Cloud Tasks authenticates with a Google-signed OIDC token and has
  no App Check token, ever. Enforcing here would break all five sweeps.
- `GET /v1/health/*` — the contract marks these `security: []`; a probe App Check can fail reports
  the wrong thing.
- `DELETE /v1/auth/session` — sign-out must succeed for a client whose attestation is broken. A user
  who cannot sign out is a worse outcome than an unattested sign-out.
- `POST /v1/sync/push` — genuinely expensive and a real candidate. The native client's App Check
  coverage on the offline path is precisely what beta telemetry has to establish first, so it is
  listed as an open question rather than silently omitted.

### 2.3 The shape of the switch

**The set is code; the mode is configuration.** That split is the point. An operator must not be
able to widen or narrow what is protected by editing an environment variable at 3am; changing the
protected set is a code change that goes through review. Whether protection is _active_ is
`APP_CHECK_ENFORCEMENT`, and flipping it back to `monitor` is the rollback with no deployment of
new code.

Other decisions worth naming:

- **`missing` and `invalid` are treated identically.** The point of attestation is that the caller
  proves it is a real app instance; "did not try" proves no more than "tried and failed".
  Distinguishing them would create a trivial bypass — omit the header.
- **Fail closed.** A verifier that throws classifies as `invalid`, which enforcement rejects. For a
  control whose entire purpose is refusing callers it cannot vouch for, the alternative is not a
  control.
- **A distinct error code, `request.app_check_rejected`, not `auth.forbidden`.** An operator
  watching a flip must be able to separate "unattested client" from "unauthorized user", and a
  client must be able to separate "refresh your token and retry" from "stop asking". It follows
  `ROUTE_NOT_FOUND_CODE`'s precedent as a transport-owned code, so nothing in the shared contract
  package changes.
- **Enforcement fires before authentication.** `registerAppCheck` is registered ahead of
  `registerAuthentication` in the same encapsulation block, so a refusal happens before any
  credential is verified, any profile is provisioned, and any garden is looked up. There is no
  ordering in which the refusal could disclose whether a garden or account exists — nothing has been
  read when it fires. This is asserted directly: enforced requests for a syntactically valid garden
  id and for nonsense return byte-identical responses.
- **App Check is now registered on the session-routes block too.** `P2-APPCHK-01` scoped monitoring
  to the authenticated routes; that left the single most expensive unauthenticated endpoint
  unobserved. It is monitor-only there like everywhere else, and it starts producing `T-COST-02`
  telemetry immediately.

### 2.4 What proves both positions

- `platform/app-check/app-check-enforcement.test.ts` — the list itself, pinned: exactly five
  endpoints, each citing a register row, no duplicates, no internal or health route, sign-out
  reachable. Plus the decision function in both modes, including "monitor rejects nothing, for every
  enforced endpoint".
- `platform/app-check/app-check-plugin.test.ts` — the hook: default is monitor; monitor logs
  `wouldReject` while returning 200; enforce returns 403; valid tokens pass; unenforced endpoints
  stay reachable; fail-closed applies only in enforce mode; the token value is still never logged.
- `tests/http/app-check-enforcement.test.ts` — the real composition root: all five endpoints refuse
  with the right code under `enforce`; none of them do under the default; health, sign-out, and the
  worker callbacks keep working; ordinary routes still fail with `auth.unauthenticated` rather than
  the App Check code.

The 1,509 pre-existing API tests are themselves evidence for the default: almost none of them send
an App Check header, and they all still pass unchanged.

### 2.5 Flipping it

`APP_CHECK_ENFORCEMENT=enforce` on the Cloud Run service. Before flipping, the question the new
telemetry answers:

```
resource.type="cloud_run_revision"
jsonPayload.event="app_check.classified"
jsonPayload.outcome="wouldReject"
```

A non-trivial count here means a real client would break. Break it down by `jsonPayload.path` to see
which endpoint and by `jsonPayload.classification` to see whether clients are failing attestation
(`invalid`) or not attempting it (`missing`) — those have different fixes. Flip only when the count
is attributable to abuse rather than to the iOS or web client.

---

## 3. IAM and secret review

Read-only inventory of `verdery-dev` (project number `417008876420`), taken 2026-07-26. Every
command was `list` / `describe` / `get-iam-policy` / `versions list`. **`gcloud secrets versions
access` was never run** — no secret material was read.

### 3.1 What is right, and worth stating

Reviews that only list problems are not reviews. These are load-bearing and correct:

- **Zero user-managed service-account keys exist.** All five service accounts return only
  `SYSTEM_MANAGED`, `GOOGLE_PROVIDED`, Google-rotated keys. There is no downloaded credential
  anywhere.
- **CI authenticates by Workload Identity Federation**, never a key: pool `github-actions`, provider
  `github-actions-oidc`, `attributeCondition: assertion.repository == 't-boris/verdery'`, and a
  `principalSet` scoped to `attribute.environment/development`.
- **The break-glass secret's own IAM policy is empty** (`{"etag": "ACAB"}`). No service account can
  read it.
- **`verdery-dev-web-runtime` holds literally zero bindings**, project-level or resource-level —
  exactly as `05-service-accounts.sh` intends.
- **The deployer is narrow**: `roles/run.developer` + `roles/artifactregistry.writer`, plus
  `iam.serviceAccountUser` on exactly the two runtime accounts and not on the compute default.
- **All four buckets** have uniform bucket-level access on and public access prevention enforced. No
  `allUsers` or `allAuthenticatedUsers` binding on any of them.
- **The API authenticates to Postgres as its own IAM identity.** No database password exists in any
  environment variable or secret mount.
- **Only one secret exists in the entire project.**

### 3.2 Findings

Ordered by what an attacker would reach for first.

**F-1 — The compute default service account holds `roles/editor`, is enabled, and runs nothing.**
`417008876420-compute@developer.gserviceaccount.com`, `"disabled": false`. `gcloud compute instances
list` returns `[]`; all 182 Cloud Run revisions run as `verdery-dev-api-runtime` or
`verdery-dev-web-runtime`. Editor on this project means: read every Secret Manager secret — including
the break-glass superuser password, which is otherwise unreachable (F-2) — write every bucket,
redeploy either Cloud Run service, and patch Cloud SQL. **Nothing depends on it.** Already noted at
`runbooks.md:1150` and `:2059`; this review confirms it is still live and quantifies the reach.
_Least-privilege delta:_ one unused identity holds more authority than every used identity combined.

**F-2 — The break-glass secret keeps all seven password versions ENABLED.**
`verdery-dev-pg-postgres-superuser-password`, versions 1–7, every one `"state": "ENABLED"`, created
between 2026-07-22 and 2026-07-24. Six are superseded passwords that `gcloud sql users set-password
postgres` has already rotated past; each remains a readable, valid-format credential artifact.
`07-iam-database-bootstrap.sh:104` adds a version per run and never disables its predecessor. This
contradicts the project's own closing check at `runbooks.md:1261` — _"A new secret version exists and
the old one is disabled or destroyed."_ Contained today only by the empty resource policy, which F-1
bypasses.

**F-3 — Live production configuration references a service account that does not exist.**
`MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL=verdery-dev-worker@verdery-dev.iam.gserviceaccount.com`
is set on the running `verdery-api-dev` service and on the `verdery-api-dev-migrate` job.
`gcloud iam service-accounts list` does not contain it. The media-processing callback therefore
validates OIDC tokens against an identity that cannot mint one — the check can never pass. Fail-closed
rather than fail-open, and the callback is unreachable anyway (Cloud Tasks API is disabled), so this
is a correctness and clarity defect rather than an exposure. Root cause:
`10-media-processing-queue.sh` has never been run. `verdery-dev-worker-database-url` and the custom
bucket-deleter role are missing for the same reason.

**F-4 — Both Cloud Run services are `allUsers` + `ingress: all`.**
`{"members": ["allUsers"], "role": "roles/run.invoker"}` and
`"run.googleapis.com/ingress": "all"` on `verdery-api-dev` and `verdery-web-dev` alike. A public web
front door is intended; a public **API** with no load balancer, no Cloud Armor, and no rate limit is
the deviation, and it is the concrete form of `T-COST-01`. `13-cloud-run-ingress.sh` exists
specifically to close it and has not been applied. **This is `P8-NET-01`, and it is also why the
Cloud Armor half of this package is not buildable: there is nothing to attach a policy to.**

**F-5 — `firebase-adminsdk-fbsvc` holds project-wide `roles/iam.serviceAccountTokenCreator`.**
Granted at project scope rather than on a specific account, so it can mint access tokens for **any**
service account in the project — including `verdery-dev-api-runtime` (bucket `objectAdmin` + Cloud
SQL login) and the compute default (F-1). Firebase auto-provisions this binding; no repository code
impersonates through it. It is the one privilege-escalation path in the policy, and it is the shortest
route from a Firebase-scoped compromise to project-wide editor.

**F-6 — No audit configuration at all.** The project's allow policy has no `auditConfigs` key.
Admin Activity logs exist by default, but `AccessSecretVersion` is a DATA_READ event and is therefore
**not logged**. `runbooks.md:1186-1201` builds an incident query for "who has read the break-glass
secret"; this review establishes that the query can only ever return nothing. The question is
currently unanswerable.

**F-7 — Legacy project-role bucket bindings turn F-1 into "reads all user media."**
All four buckets carry the GCS defaults `projectEditor:verdery-dev → roles/storage.legacyObjectOwner`
and `projectViewer:verdery-dev → roles/storage.legacyObjectReader`. UBLA and enforced PAP mean this
is not public exposure. It is the mechanism by which the unused editor-holding account in F-1 is a
full object owner on user media, raw capture, derived, and exports.

**F-8 — Cloud SQL transport and deletion posture.** `"requireSsl": false`,
`"sslMode": "ALLOW_UNENCRYPTED_AND_ENCRYPTED"`, `"connectorEnforcement": "NOT_REQUIRED"`,
`"deletionProtectionEnabled": false`. Plus a residual `authorizedNetworks` entry `67.173.81.108/32`
— an operator's home IP left behind by `07-iam-database-bootstrap.sh`'s temporary `--assign-ip`
window. Inert today because `"ipv4Enabled": false`; it re-arms the moment anything reassigns a
public IP.

**F-9 — Container images are never scanned.** The single Artifact Registry repository holds 2.74 GB
of images that run in production, with
`"enablementState": "SCANNING_DISABLED", "enablementStateReason": "API containerscanning.googleapis.com is not enabled."`

**F-10 — Roughly fourteen enabled APIs have no workload.** Fifty APIs are enabled. The entire
BigQuery family (nine), plus `analyticshub`, `dataform`, `dataplex`, `datastore`, `appengine`,
`containerregistry`, `pubsub` (zero topics, zero subscriptions), `runtimeconfig`, `testing`,
`oslogin`, `firebasehosting`, and `firebaseappdistribution` are Firebase-enablement side effects.
Each is reachable by anything holding `roles/editor` (F-1).

**F-11 — The two `maxScale` annotations disagree.** Both services carry service-level
`run.googleapis.com/maxScale: "20"` against template-level `autoscaling.knative.dev/maxScale: "2"`.
The template governs, so the effective cap is 2 — but `20` is the number a reader, or a future
`gcloud run services replace`, would act on. Combined with F-4 this is the cost-exposure knob.

### 3.3 The single highest-value action

**F-1.** It is one binding, nothing depends on it, and removing it simultaneously shrinks F-2's
blast radius (the break-glass secret becomes owner-only in practice as well as in policy), F-7's
(the buckets lose their non-owner object owner), and F-10's (the unused APIs lose their caller).
Everything else on this list is either owned by `P8-NET-01` (F-4), a Google-managed binding that
needs a considered replacement (F-5), or a change to a provisioning script that has not run yet
(F-3).

This document deliberately does not prescribe the `gcloud` commands: it is a review, the
infrastructure scripts are outside this package's ownership, and every remediation above is a
mutating change that needs its own approval.

---

## 4. Verification

| Suite            | Before                 | After                  |
| ---------------- | ---------------------- | ---------------------- |
| `@verdery/web`   | 65 files / 606 tests   | 67 files / 670 tests   |
| `@verdery/api`   | 206 files / 1509 tests | 208 files / 1550 tests |
| E2E (Playwright) | 9 specs / 37 tests     | 10 specs / 48 tests    |

The E2E figure is the important one: all 48 of those tests now run against an **enforcing** Content
Security Policy, where before there was no policy in effect at all. Reaching 48 green took three
runs; the two intermediate ones are what produced the findings in section 1.2.

## 5. Files

| File                                                              | What it is                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/shared/security/content-security-policy.ts`             | The policy, built per request. Every directive carries its justification. |
| `apps/web/shared/security/security-headers.ts`                    | The constant headers, and the nonce generator.                            |
| `apps/web/proxy.ts`                                               | Applies the policy per request; holds the `WEB_CSP_MODE` switch.          |
| `apps/web/app/internal/csp-report/route.ts`                       | The violation sink.                                                       |
| `apps/web/next.config.ts`                                         | Now serves only the constant headers.                                     |
| `apps/web/e2e/content-security-policy.spec.ts`                    | The enforcing-browser evidence.                                           |
| `services/api/src/platform/app-check/app-check-enforcement.ts`    | The reviewed endpoint list and the enforcement rule.                      |
| `services/api/src/platform/app-check/app-check-plugin.ts`         | The hook, in both modes.                                                  |
| `services/api/src/platform/configuration/configuration-schema.ts` | `APP_CHECK_ENFORCEMENT`, defaulting to `monitor`.                         |
