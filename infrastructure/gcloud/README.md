# gcloud provisioning scripts

Idempotent shell scripts that provision Google Cloud infrastructure, used instead of Terraform.
See [ADR-0011](../../docs/architecture/decisions/ADR-0011-gcloud-scripts-instead-of-terraform.md)
for why, and [../../docs/development/infrastructure.md](../../docs/development/infrastructure.md)
for the developer-facing narrative (what exists, how to deploy, how it was verified).

## Layout

```text
config/
  dev.env          Environment-specific values for verdery-dev.
  prod.env         The production values, reviewed and unapplied. See "Production" below.
  lifecycle/       Bucket lifecycle-rule JSON used by 09-media-storage.sh, environment-independent
                    (the same retention numbers apply to dev/staging/prod; only the bucket names
                    they are applied to differ, from dev.env etc.).
  cors/            Bucket CORS JSON for development. An environment that sets VERDERY_WEB_DOMAIN
                    renders its own from that value instead — 09-media-storage.sh explains why.
  monitoring/      Alert policy definitions, applied by 15-monitoring-alerts.sh with this
                    environment's resource names substituted for their __TOKEN__ placeholders.

scripts/
  lib/common.sh                        Shared helpers every script sources.
  00-create-project.sh                 Project + billing.
  01-enable-apis.sh                    Required Google Cloud APIs.
  02-network.sh                        VPC, subnet, private services access peering.
  03-cloud-sql.sh                      Cloud SQL for PostgreSQL, private IP only.
  04-artifact-registry.sh              Docker repository.
  05-service-accounts.sh               Deploy and runtime service accounts, least privilege.
  06-workload-identity-federation.sh   Keyless GitHub Actions trust.
  07-iam-database-bootstrap.sh         One-time: grants a service account database access.
  08-app-check-recaptcha.sh            reCAPTCHA Enterprise key for web App Check.
  09-media-storage.sh                  Media buckets: user-media, raw-capture, derived, exports.
  10-media-processing-queue.sh         Cloud Tasks queue and worker service account.
  11-load-balancer.sh                  P8-NET-01: global HTTPS LB, serverless NEGs, managed TLS.
  12-cloud-armor.sh                    P8-NET-01: WAF and rate-limit policy on both backends.
  13-cloud-run-ingress.sh              P8-NET-01: closes the *.run.app bypass. The cutover.
  14-cloud-sql-hardening.sh            P8-DB-01: regional HA, deletion protection, backups, limits.
  15-monitoring-alerts.sh              Notification channel and nine alert policies.
  16-budget.sh                         Billing budget with 50/90/100% thresholds.
  provision.sh                         Runs 00–06, 08, 09, and 10 in order (07 stays manual, see below).
  verify.sh                            Read-only check of what actually exists.
  deploy-migration-job.sh              Creates or updates the migration Cloud Run Job.
  deploy-api.sh                        Builds nothing; deploys an already-pushed image.
  deploy-web.sh                        Same, for the web client.
  deploy-workers.sh                    Same, for the workers service.
```

`provision.sh` runs 00–10 only. Scripts 11–16 are deliberately **not** part of it: each one either
starts a recurring bill, restarts a production database, or removes the only public path to a live
service. They refuse to run without `VERDERY_APPLY=yes`, and several refuse to run at all until
config values only the owner can supply are filled in.

## Running against a new environment

```bash
bash scripts/provision.sh dev
bash scripts/07-iam-database-bootstrap.sh dev verdery-dev-api-runtime@verdery-dev.iam.gserviceaccount.com
bash scripts/verify.sh dev
```

`07-iam-database-bootstrap.sh` is deliberately not part of `provision.sh`: it briefly assigns Cloud
SQL a public IP, restricted to the caller's own address, to grant a role membership no other API
call can perform. Run it attended, watch its output, and confirm `verify.sh` still reports the
instance has no public IP afterward.

## Deploying the API

```bash
docker buildx build --platform linux/amd64 -f services/api/Dockerfile \
  -t us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag> --push .

bash scripts/deploy-migration-job.sh dev us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
gcloud run jobs execute verdery-api-dev-migrate --project=verdery-dev --region=us-central1 --wait

bash scripts/deploy-api.sh dev us-central1-docker.pkg.dev/verdery-dev/verdery/api:<tag>
```

`.github/workflows/deploy-dev.yml` runs exactly these steps through workload identity federation —
no step exists in CI that a human cannot also run locally.

Migrations run as a Cloud Run Job with Direct VPC egress rather than directly from a workstation or
a GitHub Actions runner: Cloud SQL has no public IP, so nothing outside the VPC can reach it except
through that egress path.

---

# Production (P8-NET-01 and P8-DB-01)

**Nothing in this section has been run.** No production project exists, and every script it names
was written, syntax-checked, and reviewed without being executed. `config/prod.env` holds the
reviewed values; the ones only an owner can decide are left empty on purpose, and
`require_config` in `lib/common.sh` stops any script that needs one.

## What an owner must decide before anything can run

| Decision                | Where it goes                                                  | Blocks                                   |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| A registered domain     | `VERDERY_WEB_DOMAIN`, `VERDERY_API_DOMAIN`                     | 11, 12, 13, and the production web image |
| The alert address       | `VERDERY_ALERT_EMAIL`                                          | 15, and the on-call routing in 16        |
| A monthly budget amount | `VERDERY_BUDGET_AMOUNT_USD`                                    | 16                                       |
| ~100 USD/month for HA   | accepting `VERDERY_SQL_TIER` + `VERDERY_SQL_AVAILABILITY_TYPE` | 14                                       |
| A maintenance window    | when to run step 6 below                                       | 14 (it restarts the database)            |
| Billing-admin rights    | on the billing account, for whoever runs step 8                | 16                                       |

Two decisions are worth separating from the rest because they are commonly assumed to be free and
are not:

- **Regional HA is also a tier change.** Cloud SQL does not offer high availability on shared-core
  machine types, so `db-f1-micro` cannot be made regional. "Enable HA" and "leave the cheapest
  tier" are one decision.
- **A budget notifies; it does not cap.** Nothing in Google Cloud caps spend. The controls that
  actually bound the bill are `--max-instances`, the Cloud Armor rate limits, and the Cloud SQL
  storage auto-increase ceiling.

## Cost, per step

Approximate `us-central1` list prices. Confirm against the pricing calculator before committing;
these are the numbers the plan was reasoned with, not a quote.

| Step | What                            | Monthly cost                       | Downtime                     | Reversible                        |
| ---- | ------------------------------- | ---------------------------------- | ---------------------------- | --------------------------------- |
| 1    | Project, APIs, network, buckets | ~0 USD                             | none                         | yes                               |
| 2    | Cloud SQL instance (`03`)       | ~49 USD zonal                      | none (creation)              | yes, until it holds data          |
| 3    | Budget (`16`)                   | 0 USD                              | none                         | yes                               |
| 4    | Alert policies (`15`)           | 0 USD                              | none                         | yes                               |
| 5    | Load balancer (`11`)            | ~18 USD + ~0.01 USD/GB             | none                         | yes, delete the forwarding rule   |
| 6    | Cloud Armor (`12`)              | ~21 USD (5 policy + 16 rules)      | none; a bad rule is a 403    | yes, per rule                     |
| 7    | Cloud SQL hardening (`14`)      | ~+55 USD (HA doubles compute/disk) | **several minutes, once**    | HA yes; the restart is not undone |
| 8    | Ingress cutover (`13`)          | 0 USD                              | none if the preflight passes | yes, ~30 seconds per service      |

Steady state, with light traffic: roughly **150 USD/month**, of which the database is about two
thirds. That figure is the input to `VERDERY_BUDGET_AMOUNT_USD`, not a substitute for choosing it.

## The order, and why it is this order

```bash
export VERDERY_APPLY=yes   # every step below refuses to run without it

# 1. The existing sequence, unchanged, against the new project.
bash scripts/provision.sh prod
bash scripts/07-iam-database-bootstrap.sh prod verdery-prod-api-runtime@verdery-prod.iam.gserviceaccount.com

# 2. Money and eyes BEFORE anything expensive exists.
bash scripts/16-budget.sh prod
bash scripts/15-monitoring-alerts.sh prod

# 3. Deploy the services, so the load balancer has something to point at.
bash scripts/deploy-migration-job.sh prod <image>
gcloud run jobs execute verdery-api-migrate --project=verdery-prod --region=us-central1 --wait
bash scripts/deploy-api.sh prod <image>
bash scripts/deploy-web.sh prod <web-image>   # built WITHOUT API_PROXY_ORIGIN — see below

# 4. The edge, still parallel to the open *.run.app path.
bash scripts/11-load-balancer.sh prod
#    …then create the two DNS A records it prints, and WAIT for the managed
#    certificate to reach ACTIVE. This can take an hour after DNS propagates.
bash scripts/12-cloud-armor.sh prod

# 5. Confirm the new path works end to end before removing the old one.
bash scripts/verify.sh prod
#    Sign in through https://app.<domain> for real. A 200 on the home page is
#    not evidence; the session cookie is.

# 6. The cutover. Refuses to run unless the certificate is ACTIVE and both
#    hostnames already serve.
bash scripts/13-cloud-run-ingress.sh prod

# 7. The database, in a maintenance window, on its own.
bash scripts/14-cloud-sql-hardening.sh prod

# 8. Re-run the alert script now that the load balancer exists: three of the
#    nine policies reference the URL map and were skipped in step 2.
bash scripts/15-monitoring-alerts.sh prod
bash scripts/verify.sh prod
```

The order is not arbitrary:

- **Budget and alerts first** because they are free, instant, and the only steps that make every
  later step observable. `runbooks.md` names enabling one budget as the cheapest risk reduction
  available in the entire project; doing it after the load balancer would mean the first expensive
  week is also the unwatched one.
- **The load balancer before the ingress cutover**, with a real sign-in in between, because step 6
  removes the only working path if step 5 was skipped. `13-cloud-run-ingress.sh` enforces this
  itself — it checks the certificate status and curls both hostnames before touching anything.
- **The database last** because it is the only step with unavoidable downtime, and doing it while
  the edge cutover is still fresh would make two unrelated failures indistinguishable.

## The production web image differs from the development one

One build argument, and it is load-bearing:

```
NEXT_PUBLIC_API_ORIGIN=same-origin     # same as development
API_PROXY_ORIGIN=                      # UNSET in production
```

Behind the load balancer, `app.<domain>/v1/*` is routed straight to the API backend by the URL map,
so the Next.js rewrite that exists today is unnecessary. Leaving it in would also keep the second of
the two public routes to `/v1/internal/*` that `threat-model.md`'s `T-SSRF-06` counts. The browser
still calls relative `/v1/...` URLs; the load balancer, not the web server, delivers them.

The iOS client points at `https://api.<domain>`.

## How `/v1/internal/*` stops being publicly reachable

Three independent mechanisms, because the threat model counted two public routes and this plan
creates a third:

1. **`13-cloud-run-ingress.sh`** sets `--ingress=internal-and-cloud-load-balancing`, which removes
   the `*.run.app` route at the network layer, before IAM. That closes route one.
2. **The production web image carries no `/v1/*` rewrite**, so the web origin has no proxy to reach
   the API through. That closes route two — by construction rather than by the regex the threat
   model explicitly declined to write blind (its section 16.4).
3. **Cloud Armor rule 1000** denies `request.path.startsWith("/v1/internal/")` with a 404. The URL
   map deliberately sends `/v1/*` to the API backend, so the edge would otherwise reopen at the
   front door exactly what step 1 closed at the back.

`verify.sh` asserts all three: the direct `*.run.app` URL must not answer 200, and
`POST /v1/internal/deletion/sweep` must not answer 200 on either hostname.

The legitimate callers are unaffected. `services/workers` reaches the API on the internal path,
which never traverses the load balancer and therefore never meets rule 1000. The `allUsers` invoker
binding stays in place on both services and that is correct — a serverless NEG forwards requests
without an identity token, so removing it would 403 every request through the load balancer. The
control is reachability, not IAM; `13-cloud-run-ingress.sh`'s header has the full reasoning, and
prints it at the end of every run so the next person does not "fix" it.

## Rolling back

| Step | Rollback                                                                                                            | Time    |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| 13   | `gcloud run services update <service> --ingress=all`, per service                                                   | ~30 s   |
| 12   | `gcloud compute security-policies rules delete <priority>` or `--preview` a rule                                    | seconds |
| 11   | Delete the forwarding rules; the reserved IP survives so DNS stays valid                                            | minutes |
| 14   | `--availability-type=ZONAL` restores the cost but costs another restart; deletion protection is a one-flag reversal | minutes |
| 15   | Delete policies by display name                                                                                     | seconds |
| 16   | `gcloud billing budgets delete`                                                                                     | seconds |

Nothing in the sequence destroys data. Step 14 is the only one that interrupts service, and it
interrupts it in both directions.
