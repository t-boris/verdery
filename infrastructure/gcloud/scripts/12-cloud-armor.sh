#!/usr/bin/env bash
# Creates the Cloud Armor security policy for the edge and attaches it to both
# backend services created by 11-load-balancer.sh.
#
# SCOPE BOUNDARY: DRAFTED AND SYNTAX-CHECKED (`bash -n`), NOT executed against
# any project. It bills (see "Cost") and it can reject real user traffic, so it
# calls `require_explicit_apply`.
#
# ---------------------------------------------------------------------------
# WHAT THIS CLOSES
#
# The threat model's section 13 gap list is the requirements document for this
# file. Today there is no rate limit anywhere in the product except one:
# `T-COST-06`, a partial unique index that allows one active export per
# requester. Everything else is open:
#
#   T-COST-01  unauthenticated request flood     -> rule 9000 (baseline)
#   T-COST-02  POST /v1/auth/session cost abuse  -> rule 3000 (rate-based ban)
#   T-COST-03  unbounded upload registration     -> rule 3200 (partial; the
#              real fix is an owner-chosen storage quota enforced in the API —
#              this only bounds the RATE, not the total)
#   T-COST-04  processing amplification          -> rule 3200, same caveat
#   T-SSRF-06  /v1/internal/* publicly routable  -> rule 1000
#
# Cloud Armor is not a substitute for application authentication and
# authorization (networking.md section 6 says so explicitly). Every rule here
# bounds COST and RATE. None of them decides who may see what.
#
# ---------------------------------------------------------------------------
# RULE ORDER, WHICH MATTERS MORE THAN IT LOOKS
#
# Cloud Armor evaluates in ascending priority and the FIRST matching rule wins.
# A rate-limit rule whose request conforms matches with action `allow`, which
# terminates evaluation — so a rule placed above the managed WAF rules would
# exempt its traffic from WAF inspection entirely. The order below is therefore
# deliberate:
#
#   1000        deny /v1/internal/*        (nothing public may reach it, ever)
#   2000-2900   preconfigured WAF rules    (inspect everything that survives)
#   3000-3200   per-endpoint rate limits   (the expensive endpoints)
#   9000        baseline rate limit        (everything else)
#   2147483647  default allow              (created automatically)
#
# Preview-mode rules record and continue rather than terminating, so the WAF
# block does not shadow the rate limits below it.
#
# ---------------------------------------------------------------------------
# COST
#
#   Cloud Armor Standard policy            5 USD/month
#   Each rule                              1 USD/month  (15 rules here, plus
#                                          the implicit default-allow rule)
#   Requests                               0.75 USD per million
#
# Adaptive Protection is deliberately NOT enabled: it requires Cloud Armor
# Enterprise, whose subscription is three orders of magnitude above this
# project's entire infrastructure spend, and its value is ML-detected volumetric
# anomalies on traffic volumes this product does not have.
#
# DOWNTIME: none, but a false positive is a user-visible 403/429. Every managed
# WAF rule that inspects request BODIES is created in preview mode for exactly
# that reason — see the table below.
#
# Idempotent: the policy and every rule are checked by priority before
# creation, so a re-run after a partial failure resumes. Changing a threshold
# means editing the number here and deleting that one priority, not re-running
# blindly.
#
# Source: implementation-plan.md work package P8-NET-01;
# architecture/networking.md section 6 ("Cloud Armor");
# development/threat-model.md sections 13, 15.5, and 15.9.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source lib/common.sh

ENVIRONMENT="${1:?usage: 12-cloud-armor.sh <environment>}"
load_environment_config "${ENVIRONMENT}"
require_active_project
require_explicit_apply \
  "creates a Cloud Armor policy (~21 USD/month) that can reject real user traffic."

enable_api_if_needed compute.googleapis.com

# --- policy -----------------------------------------------------------------
if resource_exists gcloud compute security-policies describe "${VERDERY_ARMOR_POLICY_NAME}" \
  --project="${VERDERY_PROJECT_ID}"; then
  log "Security policy already exists: ${VERDERY_ARMOR_POLICY_NAME}"
else
  log "Creating security policy: ${VERDERY_ARMOR_POLICY_NAME}"
  gcloud compute security-policies create "${VERDERY_ARMOR_POLICY_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --description="Verdery production edge policy (P8-NET-01)"
fi

# Verbose logging records which rule matched and, for preview rules, which rule
# WOULD have matched. Without it the preview mode below produces nothing to
# read and the whole staged rollout is theatre.
log "Enabling verbose Cloud Armor logging"
gcloud compute security-policies update "${VERDERY_ARMOR_POLICY_NAME}" \
  --project="${VERDERY_PROJECT_ID}" \
  --log-level=VERBOSE \
  >/dev/null

rule_exists() {
  resource_exists gcloud compute security-policies rules describe "${1}" \
    --security-policy="${VERDERY_ARMOR_POLICY_NAME}" --project="${VERDERY_PROJECT_ID}"
}

# usage: create_rule <priority> <description> <gcloud rule flags...>
create_rule() {
  local priority="${1}" description="${2}"
  shift 2

  if rule_exists "${priority}"; then
    log "Rule ${priority} already exists (${description})"
    return
  fi

  log "Creating rule ${priority}: ${description}"
  gcloud compute security-policies rules create "${priority}" \
    --security-policy="${VERDERY_ARMOR_POLICY_NAME}" \
    --project="${VERDERY_PROJECT_ID}" \
    --description="${description}" \
    "$@" \
    >/dev/null
}

# ---------------------------------------------------------------------------
# 1000 — /v1/internal/* is not a public path
# ---------------------------------------------------------------------------
# `T-SSRF-06`. Nine machine-to-machine endpoints live under the same public
# base path as user routes: /v1/internal/{deletion/sweep, exports/*,
# weather-refresh/sweep, recommendation-evaluation/sweep, notifications/events,
# notification-delivery/sweep, media-processing-jobs/:jobId/callback,
# media-retention/sweep}. Each verifies a Google-signed OIDC token with an
# exact audience and service-account email before doing anything, so this is
# not an authorization bypass — but every rejection still costs a token
# verification, which is precisely the unauthenticated cost surface `T-COST-02`
# describes.
#
# 13-cloud-run-ingress.sh removes the *.run.app route to these endpoints, and
# the production web image carries no `/v1/*` rewrite (11-load-balancer.sh's
# header), which together close both routes the threat model counted. This rule
# closes the third one that those two steps CREATE: the load balancer now
# deliberately sends /v1/* to the API, so without this the edge would reopen by
# the front door what the ingress restriction just closed at the back.
#
# The legitimate callers are unaffected: `services/workers` reaches the API on
# the internal path, which never traverses the load balancer and so never sees
# this rule.
#
# 404, not 403: a 403 confirms the path exists. There is no reason to tell an
# unauthenticated caller which internal endpoints are real.
create_rule 1000 "Deny /v1/internal/* from the public edge (T-SSRF-06)" \
  --expression='request.path.startsWith("/v1/internal/")' \
  --action=deny-404

# ---------------------------------------------------------------------------
# 2000-2900 — preconfigured WAF rules
# ---------------------------------------------------------------------------
# networking.md section 6: "Managed threat rules introduced in preview mode
# before enforcement." That instruction is applied selectively rather than
# uniformly, because "preview everything" and "enforce everything" are both
# wrong answers:
#
#   ENFORCE  rules that match on request STRUCTURE (method, protocol, path
#            traversal, known CVE signatures). These match things a correct
#            client never sends, so a false positive means a broken client, not
#            a legitimate one. Enforcing immediately is safe and is the only
#            way they help on day one.
#   PREVIEW  rules that match on request CONTENT (SQL injection, XSS, scanner
#            signatures). This API accepts free-text plant names, care notes,
#            and bilingual user content; OWASP CRS reliably flags apostrophes,
#            angle brackets, and the word "select" inside legitimate JSON. These
#            go to preview, and the promotion to enforce is a separate,
#            evidence-based decision after reading the request logs.
#
# Sensitivity 1 (OWASP paranoia level 1) throughout: higher levels raise the
# false-positive rate faster than the detection rate, and the traffic this
# policy protects is a JSON API plus a static Next.js bundle, not a CMS.
#
# Rules deliberately NOT enabled, with reasons, because an unexplained omission
# is a question nobody can answer later:
#   php-v33-stable            no PHP anywhere in the stack
#   java-v33-stable           no Java anywhere in the stack
#   sessionfixation-v33-stable  matches PHP/ASP session parameters this API
#                             does not have; the session is an HttpOnly cookie
#   json-sqli-canary          overlaps sqli-v33-stable, which is already in
#                             preview here for exactly the false-positive
#                             reason that makes a second JSON-specific SQLi
#                             rule redundant until the first one is enforced
#   *-v422-*                  a newer OWASP CRS generation (4.22) exists for
#                             most families but not for nodejs, so adopting it
#                             would mean running two generations at once. One
#                             generation is easier to reason about; moving the
#                             whole set to v422 is a deliberate later change,
#                             not something to do halfway
#
# The `-v33-stable` suffix matters. `-canary` sets carry the newest signatures
# with the least soak time, and `-stable` is the right default for a policy
# that fronts real users.
#
# The set of valid expression-set names changes over time, and this list was
# checked against the live catalog while it was written — which is how
# `cve-v33-stable` was found NOT to exist (only `cve-canary` does; see rule
# 2600 below). Every name is therefore re-verified at run time before any rule
# is created, so a catalog change fails loudly and early rather than halfway
# through, leaving a partially built policy.
log "Verifying preconfigured WAF expression-set names against the live catalog"
available_expression_sets="$(gcloud compute security-policies list-preconfigured-expression-sets \
  --project="${VERDERY_PROJECT_ID}" --format="value(id)")"

# priority|expression-set|mode|why
WAF_RULES=(
  "2000|methodenforcement-v33-stable|enforce|Blocks TRACE/TRACK/CONNECT and other methods the OpenAPI contract never uses"
  "2100|protocolattack-v33-stable|enforce|Request smuggling, response splitting, header injection"
  "2200|lfi-v33-stable|enforce|Local file inclusion and path traversal; no route takes a filesystem path"
  "2300|rfi-v33-stable|enforce|Remote file inclusion; T-SSRF-01 confirms no URL input exists"
  "2400|rce-v33-stable|enforce|Remote command execution; T-UPL-08 confirms nothing spawns a process"
  "2500|nodejs-v33-stable|enforce|Node-specific injection patterns; both services are Node"
  "2600|cve-canary|preview|Known-CVE signatures; canary is the ONLY generation Google publishes for this family, so it runs in preview rather than enforcing signatures with no soak time"
  "2700|sqli-v33-stable|preview|Free-text plant names and care notes trip CRS SQL patterns"
  "2800|xss-v33-stable|preview|Same: user text with angle brackets is legitimate content here"
  "2900|scannerdetection-v33-stable|preview|User-agent based; would also block our own diagnostics"
)

for entry in "${WAF_RULES[@]}"; do
  IFS='|' read -r priority expression_set mode why <<<"${entry}"

  if ! grep -qx "${expression_set}" <<<"${available_expression_sets}"; then
    fail "Preconfigured expression set '${expression_set}' is not in this project's catalog. Run: gcloud compute security-policies list-preconfigured-expression-sets"
  fi

  if [[ "${mode}" == "preview" ]]; then
    create_rule "${priority}" "WAF ${expression_set} (preview): ${why}" \
      --expression="evaluatePreconfiguredWaf('${expression_set}', {'sensitivity': 1})" \
      --action=deny-403 \
      --preview
  else
    create_rule "${priority}" "WAF ${expression_set}: ${why}" \
      --expression="evaluatePreconfiguredWaf('${expression_set}', {'sensitivity': 1})" \
      --action=deny-403
  fi
done

# ---------------------------------------------------------------------------
# 3000 — POST /v1/auth/session, the most expensive unauthenticated endpoint
# ---------------------------------------------------------------------------
# `T-COST-02`. Every call costs a Firebase `verifyIdToken` AND a
# `createSessionCookie` before the API can even decide the caller is hostile.
#
# THE NUMBERS, FROM DEMAND RATHER THAN FROM A ROUND FIGURE:
# a real user exchanges an ID token for a session cookie once at sign-in, and
# again when the client refreshes a cookie that lasts days — call it twice per
# device per week in steady state, plus a handful of retries on a flaky
# network. A household or small office behind one NAT address, five people,
# two devices each, all signing in on the same morning, is 10 calls in a few
# minutes. 20 per 5 minutes per IP is double that worst realistic case and is
# still four orders of magnitude below what a script can generate.
#
# `rate-based-ban`, not plain `throttle`: a plain 429 costs an attacker
# nothing, so they keep sending and the edge keeps counting. Exceeding the
# threshold here bans the source IP for 300 s, which converts a sustained
# attack from "expensive for us" into "pointless for them". The ban is short
# enough that a shared NAT address that trips it recovers within one coffee
# break, which is the reason it is 5 minutes and not an hour.
#
# The rule covers the whole `/v1/auth/` prefix — session create, refresh, and
# sign-out — because they share the same cost profile and a limit scoped to one
# path just moves the abuse to its neighbour.
create_rule 3000 "Rate-based ban on /v1/auth/*: 20 per 5 min per IP, 5 min ban (T-COST-02)" \
  --expression='request.path.startsWith("/v1/auth/")' \
  --action=rate-based-ban \
  --rate-limit-threshold-count=20 \
  --rate-limit-threshold-interval-sec=300 \
  --ban-duration-sec=300 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP

# ---------------------------------------------------------------------------
# 3100 — export generation
# ---------------------------------------------------------------------------
# `T-COST-06` is already mitigated in the application: one active export per
# requester, pre-checked for a friendly 409 and enforced for the race by the
# `export_request_one_active_per_requester` partial unique index. That control
# is correct and this rule does not duplicate it — it bounds what happens
# BEFORE authentication, where the index cannot help, and it bounds the 409s
# themselves, each of which is a database round trip.
#
# 10 per hour per IP: a user who generates an export, waits for it, downloads
# it, and decides to regenerate it does so a handful of times a day at most.
# Ten is generous for a shared address and leaves the friendly-409 path fully
# usable.
create_rule 3100 "Throttle /v1/exports: 10 per hour per IP (T-COST-06 edge half)" \
  --expression='request.path.startsWith("/v1/exports")' \
  --action=throttle \
  --rate-limit-threshold-count=10 \
  --rate-limit-threshold-interval-sec=3600 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP

# ---------------------------------------------------------------------------
# 3200 — media upload registration
# ---------------------------------------------------------------------------
# `T-COST-03` (unbounded upload registration) and `T-COST-04` (one upload fans
# out to validation, derivatives, and a tile pyramid). The register is explicit
# that the real fix is a storage quota with owner-chosen numbers enforced in
# the API; this rule bounds the RATE only, and does not pretend to bound the
# TOTAL.
#
# `POST /v1/gardens/{gardenId}/media` is the registration route
# (services/api/src/modules/media/transport/media-routes.ts). 60 per 10 minutes
# per IP: importing a season's worth of photos in one sitting is the heaviest
# legitimate burst this product produces, and 30-40 photos is a large one.
# Sixty leaves room for that plus the retries a phone on a weak connection
# generates, while capping the fan-out at six registrations a minute sustained.
#
# The regex is anchored so that it matches the registration route and not the
# `/complete` or `/delete` sub-routes below it — completing an upload is cheap
# and is exactly what a legitimate bulk import does most often.
create_rule 3200 "Throttle media registration: 60 per 10 min per IP (T-COST-03, T-COST-04)" \
  --expression='request.path.matches("^/v1/gardens/[^/]+/media$")' \
  --action=throttle \
  --rate-limit-threshold-count=60 \
  --rate-limit-threshold-interval-sec=600 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP

# ---------------------------------------------------------------------------
# 9000 — baseline
# ---------------------------------------------------------------------------
# `T-COST-01`. Everything not matched above, including the web bundle, the sync
# endpoints, and every ordinary domain read and write.
#
# 600 per minute per IP is 10 requests per second sustained. Sizing it from the
# heaviest legitimate client: an initial web page load is tens of requests, and
# an iOS sync pass is bounded by `MAX_PUSH_BATCH_SIZE` on push and a limit of
# 100 on pull, so a full catch-up after a long offline period is tens of
# requests, not thousands. Map tiles and media bytes do NOT pass through here
# at all — they are signed Cloud Storage URLs the browser fetches directly — so
# the traffic this counts is JSON and static assets only. No real client
# approaches 10 rps; a script trivially exceeds it.
#
# `throttle` with a 429, not a ban: carrier-grade NAT genuinely puts hundreds
# of mobile users behind one address, and banning that address for five minutes
# would be a real outage for real people. A 429 is a signal a well-behaved
# client backs off from and a hostile one cannot ignore either, since the
# request never reaches Cloud Run.
#
# `--src-ip-ranges="*"` rather than an `--expression`: it is the documented
# catch-all form, and the two flags are mutually exclusive.
create_rule 9000 "Baseline throttle: 600 per minute per IP (T-COST-01)" \
  --src-ip-ranges="*" \
  --action=throttle \
  --rate-limit-threshold-count=600 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP

# --- attach to both backends ------------------------------------------------
# Both, not just the API. The web backend serves the Next.js bundle and is the
# hostname the browser actually resolves; leaving it unprotected would mean the
# cheapest way to burn Cloud Run instances is to request the home page in a
# loop.
attach_policy() {
  local backend_name="${1}"
  local attached

  attached="$(gcloud compute backend-services describe "${backend_name}" \
    --project="${VERDERY_PROJECT_ID}" --global --format="value(securityPolicy)")"

  if [[ "${attached}" == *"${VERDERY_ARMOR_POLICY_NAME}" ]]; then
    log "Policy already attached to ${backend_name}"
    return
  fi

  log "Attaching ${VERDERY_ARMOR_POLICY_NAME} to ${backend_name}"
  gcloud compute backend-services update "${backend_name}" \
    --project="${VERDERY_PROJECT_ID}" \
    --global \
    --security-policy="${VERDERY_ARMOR_POLICY_NAME}" \
    >/dev/null
}

attach_policy "${VERDERY_LB_API_BACKEND_NAME}"
attach_policy "${VERDERY_LB_WEB_BACKEND_NAME}"

log "Cloud Armor policy ${VERDERY_ARMOR_POLICY_NAME} is live on both backends."
log ""
log "Rules 2600, 2700, 2800, and 2900 are in PREVIEW: they log what they would have"
log "blocked and block nothing. Read a week of real traffic before promoting"
log "any of them:"
log ""
log "  gcloud logging read \\"
log "    'resource.type=\"http_load_balancer\" AND jsonPayload.previewSecurityPolicy.outcome=\"DENY\"' \\"
log "    --project=${VERDERY_PROJECT_ID} --limit=50 --freshness=7d"
log ""
log "Promote one at a time with:"
log "  gcloud compute security-policies rules update <priority> \\"
log "    --security-policy=${VERDERY_ARMOR_POLICY_NAME} --project=${VERDERY_PROJECT_ID} --no-preview"
