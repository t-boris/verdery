# Reliability and Disaster Recovery Design

> Status: Draft 0.2
> Decision status: Approved baseline  
> Last updated: July 22, 2026

## 1. Purpose

This document defines availability expectations, failure isolation, retries, backup, point-in-time recovery, media recovery, regional disaster response, recovery objectives, and validation.

## 2. Service Tier

The production baseline is a standard consumer-production tier:

- Primary region: `us-central1`.
- Cloud SQL regional high availability.
- Point-in-time database recovery.
- Stateless multi-instance-capable Cloud Run API.
- Durable queues and job state.
- Private media with lifecycle and deletion controls.

Active/active multi-region writes are not part of the initial architecture.

## 3. Objectives

Initial production targets, subject to validation before launch:

- Core domain database RPO: no more than five minutes under covered database failure and PITR capability.
- Core service RTO: no more than one hour for normal regional-instance or application recovery.
- Full regional disaster RTO: best effort within four hours for the initial release, dependent on Google service availability and restore validation.
- Rebuildable derivatives may have a longer recovery time.
- Pending offline device work remains protected locally until accepted.

These are engineering targets, not a contractual SLA.

## 4. Failure Domains

The design considers:

- One API instance failure.
- Bad application revision.
- Cloud SQL primary-zone failure.
- Database corruption or destructive command.
- Queue or job backlog.
- Cloud Storage object loss or accidental deletion.
- External provider outage.
- Firebase Authentication or FCM degradation.
- `us-central1` regional outage.
- Credential compromise.
- Client offline or process termination.

## 5. API Reliability

- Cloud Run instances are stateless.
- Readiness prevents traffic before initialization.
- Graceful shutdown drains requests and closes transactions.
- Maximum instances protect database capacity.
- Client and load-balancer retries apply only to safe or idempotent operations.
- Deployment traffic can roll back to a known compatible revision.
- Critical provider calls are not inside domain transactions.

Minimum instances default to zero initially. A minimum of one is enabled when measured cold-start latency violates product objectives.

## 6. Database Availability

Production Cloud SQL uses:

- Regional high availability.
- Automated backups.
- Point-in-time recovery.
- Storage auto-growth with alerting and maximum-cost review.
- Deletion protection.
- Restricted maintenance scheduling where supported.
- Connection and replica health monitoring.

Application transactions retry only documented transient database outcomes and remain idempotent.

## 7. Database Backup

Backup policy includes:

- Automated backups with approved retention.
- Continuous/PITR log retention sufficient for the RPO target.
- Pre-migration on-demand backup or recovery point for high-risk changes.
- Backup access separated from ordinary application identity.
- Monitoring of backup success and age.

Backups are not considered valid until restoration is tested.

## 8. Restore Testing

At least quarterly before material scale, and more frequently for high-risk changes:

1. Restore production-like backup into an isolated recovery project or instance.
2. Verify PostgreSQL and PostGIS extension compatibility.
3. Verify schema migration state.
4. Run integrity and representative application queries.
5. Verify synchronization sequence and outbox behavior.
6. Reconcile sample Cloud Storage references.
7. Record actual RPO/RTO and corrective actions.

Production data used in a restore exercise remains protected and access-controlled.

## 9. Media Durability

Cloud Storage is the durable binary store. Protection options by class include:

- Object versioning or soft-delete capability where cost and deletion obligations allow it.
- Bucket lifecycle rules.
- Checksums and verification.
- Separate originals and derived objects.
- Orphan reconciliation.

User-requested permanent deletion takes precedence over operational recovery after the communicated recovery window.

## 10. Cross-System Consistency

Database and Cloud Storage do not share one transaction. Reconciliation detects:

- Metadata without object.
- Object without metadata.
- Available record with failed verification.
- Deleted record with remaining derivatives.
- Processing output without accepted job attempt.

Repair commands are idempotent and audited.

## 11. Queue and Job Reliability

- Domain events originate from a transactional outbox.
- Tasks and messages are duplicate-safe.
- Dead-letter destinations are monitored.
- Long jobs checkpoint progress.
- Job attempts use expected-revision terminal updates.
- Cancellation and terminal failure are explicit.
- Backlog does not block core read access.

## 12. Provider Degradation

### Weather and Maps

Use fresh-enough cached data with a stale indicator when licensing and product behavior permit it.

### Vertex AI

Use deterministic recommendation fallback and delay optional generated explanation.

### FCM

Preserve in-app notification intent; push is best-effort transport.

### Firebase Authentication

Existing server-verifiable credentials may continue within safe validity; new authentication may be unavailable. Do not weaken verification during outage.

## 13. Client Reliability

- Native local changes and outbox commit atomically.
- Uploads resume or fail recoverably.
- Sync checkpoints after every page and result.
- Web drafts protect complex unsaved editing but do not claim server persistence.
- API compatibility covers supported mobile versions.

## 14. Regional Disaster Strategy

The initial regional recovery process is active/passive and operationally initiated:

1. Declare regional disaster and freeze risky writes where possible.
2. Select an approved alternate US region.
3. Apply the versioned recovery configuration through the approved gcloud scripts.
4. Restore Cloud SQL from the latest usable backup/PITR capability available to the target.
5. Recreate Cloud Run, jobs, queues, secrets access, and networking.
6. Validate storage availability and processing references.
7. Run data integrity and smoke tests.
8. Shift API DNS/load-balancer routing.
9. Monitor sync replay, idempotency, and provider configuration.

Cross-region media replication is considered separately based on storage class, cost, deletion, and regional requirements.

## 15. Destructive Change Protection

- Provisioning-script enforcement of deletion protection for production Cloud SQL and critical buckets where compatible with deletion workflows.
- Separate migration identity.
- Expand/contract schema changes.
- Approval for production destructive commands.
- Bounded batch deletion.
- Point-in-time recovery before high-risk migrations.
- Audit of administrative repair operations.

## 16. Data Integrity Checks

Automated or scheduled checks include:

- Foreign-key and ownership consistency.
- Valid PostGIS geometries.
- Current revision versus revision journal.
- Sync sequence continuity.
- Outbox stuck records.
- Media reference reconciliation.
- Garden owner invariant.
- Job terminal state consistency.

Checks report and quarantine; they do not perform broad automatic destructive repair.

## 17. Capacity Reliability

Monitor and limit:

- Cloud SQL CPU, memory, storage, IOPS, and connections.
- Direct VPC subnet IPs.
- Cloud Run max instances and concurrency.
- Queue oldest age.
- Bucket growth.
- Provider quotas.
- Vertex AI and scan concurrency.

Capacity alerts fire before hard exhaustion.

## 18. Runbooks

Required runbooks:

- API bad deployment rollback.
- Cloud SQL failover and connectivity.
- Database restore.
- Regional recovery.
- Queue backlog and dead letter.
- Media deletion/reconciliation failure.
- Provider outage.
- Credential compromise.
- Cross-garden authorization incident.
- Cost anomaly.

## 19. Exercises

- Application rollback at least per major release process change.
- Database restore quarterly before material scale.
- Queue replay and dead-letter exercise.
- Credential revocation exercise.
- Tabletop regional disaster exercise.
- Account deletion verification.

## 20. Completion Criteria

- Production database has regional HA, backups, PITR, and deletion protection.
- Restore is tested and timed.
- Queues and jobs fail without losing authoritative state.
- Core garden use degrades gracefully during optional-provider outage.
- Regional recovery has a documented alternate-region procedure.
- User offline work and verified media have independent durability paths.
