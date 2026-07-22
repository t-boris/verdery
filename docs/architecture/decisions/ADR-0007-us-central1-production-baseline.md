# ADR-0007: United States Market and `us-central1` Production Baseline

> Status: Accepted  
> Date: July 21, 2026

## Context

The first target market is the United States. The initial system should minimize latency and cross-region data transfer while preserving a clear disaster-recovery path.

## Decision

Use `us-central1` as the primary region for the API, Cloud SQL, jobs, queues where regional selection applies, and primary media processing. Use separate development, staging, and production projects. Production Cloud SQL uses regional high availability, private IP, point-in-time recovery, and Direct VPC egress from authorized Cloud Run workloads.

The production API is exposed through a global HTTPS Load Balancer with Cloud Armor. Early non-production environments may use simpler authenticated connectivity.

## Consequences

- The primary data plane remains inside the United States unless a documented provider flow requires otherwise.
- Regional service failure is covered by Google-managed regional availability, while a full cross-region application failover is deferred.
- Recovery procedures must support rebuilding compute and restoring data into an approved alternate US region.
- Expansion into regulated non-US markets requires a new residency and regionalization ADR.
