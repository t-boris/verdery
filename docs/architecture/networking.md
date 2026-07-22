# Google Cloud Networking Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines public ingress, Cloud Run connectivity, private Cloud SQL access, subnets, egress, DNS, service-to-service authentication, environment isolation, and network observability.

## 2. Regional Baseline

The first market is the United States. The primary application region is `us-central1` for Cloud Run, Cloud SQL, Cloud Run Jobs, and regional asynchronous resources where supported.

Firebase App Hosting and global Firebase services use their managed delivery topology. Domain data-plane services remain region-aligned where the product controls placement.

## 3. Production Topology

```text
Internet
   │
   ├────────────► Firebase App Hosting / Cloud CDN
   │
   ▼
Global HTTPS Load Balancer
   │
Cloud Armor
   │
Serverless NEG
   │
Cloud Run API
   │
Direct VPC egress: private ranges only
   │
Private application subnet
   │
Private Service Access
   │
Cloud SQL PostgreSQL private IP
```

Cloud Storage, Pub/Sub, Cloud Tasks, Secret Manager, and other Google APIs are accessed through authenticated Google APIs using the documented routing policy.

## 4. Environment Isolation

Development, staging, and production use separate Firebase and Google Cloud projects. Each project has separate:

- VPC network.
- Subnets.
- Cloud SQL instance.
- Service accounts.
- Buckets.
- Queues and topics.
- DNS and application domains.
- Secrets and observability data.

No VPC peering or shared database exists between production and non-production by default.

## 5. Public Ingress

### Production API

Production uses:

- Global external HTTPS Load Balancer.
- Google-managed TLS certificate.
- Cloud Armor policy.
- Serverless network endpoint group targeting Cloud Run.
- Cloud Run ingress restricted to the load balancer path where supported.
- Custom API domain.

### Development and Staging

Non-production may use direct Cloud Run URLs with IAM or controlled public access when this materially simplifies testing. Staging should exercise the production ingress path before launch.

## 6. Cloud Armor

Baseline policy includes:

- Allow expected HTTP methods and normal traffic.
- Rate limits for authentication, upload-session, scan, AI, and export endpoints.
- Managed threat rules introduced in preview mode before enforcement.
- Geographic rules only when a documented product or legal requirement exists.
- Emergency block capability.

Cloud Armor is not a substitute for application authentication and authorization.

## 7. Cloud Run Ingress

- The interactive API is the public domain-operation entry point.
- Internal worker handlers require IAM authentication and are not internet-public.
- Cloud Run Jobs expose no public HTTP ingress.
- Administrative repair endpoints are private or require stronger administrative identity and network controls.
- Default service URLs are disabled or restricted when the load-balancer-only path is enforced.

## 8. Direct VPC Egress

Staging and production Cloud Run API and database-using workers connect to the VPC through Direct VPC egress.

Baseline routing is `private-ranges-only`:

- Private Cloud SQL traffic uses the VPC.
- Ordinary public provider traffic does not require Cloud NAT.
- Google API routing follows Private Google Access or documented default Google API paths.

Direct VPC startup and transient connection behavior requires retry-capable database clients and startup probes.

## 9. Subnet Design

Use a dedicated regional application subnet sized for Cloud Run instance and job IP behavior with growth margin. Provisioning configuration validates non-overlap and prevents accidental exhaustion.

Suggested logical allocation:

- Application services and worker address range.
- Reserved private service access range for Cloud SQL.
- Future restricted workloads if justified.

Exact CIDRs are infrastructure implementation values and must not appear in application code.

## 10. Cloud SQL Connectivity

Production Cloud SQL uses:

- Private IP only.
- Regional placement aligned with API.
- Supported authenticated connector or private-IP driver configuration.
- TLS according to Cloud SQL support and driver requirements.
- Dedicated application database identity.
- Bounded connection pool.

The current development instance has no public IP. Cloud Run and the migration job use Direct VPC egress to its private IP and authenticate through Cloud SQL IAM. A future temporary public-IP administrative procedure would require an explicit, time-bounded runbook and would not justify public production access.

## 11. Connection Pooling

Cloud Run horizontal scaling can create excessive PostgreSQL connections. The service defines:

- Maximum Cloud Run instances.
- Maximum pool size per instance.
- Request concurrency per instance.
- Reserved connections for migrations and operations.
- Connection acquisition timeout.
- Idle connection lifetime.

Managed connection pooling such as PgBouncer is introduced only after measuring connection pressure and compatibility requirements.

## 12. Google API Access

Workloads use Google client libraries and workload identity for Cloud Storage, Pub/Sub, Cloud Tasks, Secret Manager, and Vertex AI.

Private Google Access is enabled on relevant subnets. VPC Service Controls are deferred until a compliance or exfiltration-risk requirement justifies their operational complexity.

## 13. Internet Egress

External providers are reached through normal Cloud Run egress under strict application timeouts and allowlisted destination policy where practical.

Cloud NAT is introduced when:

- All traffic must route through the VPC.
- A provider requires stable source IP.
- Central egress inspection becomes a requirement.

Adding NAT requires cost, cold-start, capacity, and availability review.

## 14. DNS and Domains

Use separate domains or subdomains:

```text
app.<product-domain>
api.<product-domain>
staging-app.<product-domain>
staging-api.<product-domain>
```

DNS changes are managed by versioned provisioning scripts where supported. Production domains enforce HTTPS and HSTS after validation.

## 15. CORS and Browser Boundaries

The API allowlists exact deployed web origins. Wildcard credentialed CORS is prohibited. Preview environments use controlled origin registration or a non-cookie test authentication path.

Preflight caching is configured deliberately and does not widen methods or headers beyond the OpenAPI contract.

## 16. Service-to-Service Authentication

- Cloud Tasks attaches an OIDC token for its target service account.
- Pub/Sub push subscriptions use authenticated delivery when used.
- Workflows invokes Cloud Run through IAM.
- Jobs access resources through their own service account.
- Shared static API keys are prohibited for internal Google Cloud calls.

The receiving service verifies intended audience and service identity.

## 17. Storage Transfer

Clients upload directly to Cloud Storage through backend-authorized resumable sessions. This is public internet-to-Google storage traffic protected by short-lived scoped authorization.

Storage buckets remain private and do not expose public website access.

## 18. Network Security

- Least-privilege firewall rules.
- No inbound database access from public networks in production.
- No SSH access to serverless workloads.
- Service identities, not source IP alone, authorize Google Cloud calls.
- Network tags and firewall rules are applied only where Direct VPC behavior supports them and a requirement exists.
- Untrusted media processors have restricted egress where feasible.

## 19. Availability

- Load balancer and Firebase delivery are managed global services.
- Cloud Run API scales across the selected region.
- Cloud SQL uses regional high availability.
- VPC and subnet capacity includes deployment overlap and burst margin.
- DNS TTL supports safe changes without creating frequent resolution load.

The initial architecture does not provide active/active multi-region domain writes.

## 20. Observability

Monitor:

- Load balancer request and error rates.
- Cloud Armor matches and throttles.
- Cloud Run ingress denials.
- Direct VPC IP utilization.
- VPC egress connection failures.
- Cloud SQL connections and acquisition latency.
- DNS and certificate health.
- Provider egress latency and failure.
- NAT utilization if introduced.

Flow logging is enabled only with privacy, volume, and utility review.

## 21. Testing

- Production ingress bypass attempts.
- Direct Cloud Run URL restrictions.
- Cloud Armor preview and enforcement.
- CORS allowlist and credential behavior.
- Private Cloud SQL connectivity.
- Service-to-service audience validation.
- Subnet exhaustion alarm.
- Connection reset and retry.
- Certificate renewal and HSTS rollout.
- Provider requiring stable egress before any NAT change.

## 22. Completion Criteria

- Production clients cannot reach Cloud SQL directly.
- Public domain operations enter through the protected load balancer path.
- Internal handlers require IAM identity.
- Cloud Run scaling remains within subnet and database connection capacity.
- NAT and complex perimeter products are absent until justified.
- Production and non-production networks are isolated.
