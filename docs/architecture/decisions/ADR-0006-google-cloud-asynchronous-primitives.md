# ADR-0006: Google Cloud Asynchronous Primitives and Transactional Outbox

> Status: Accepted  
> Date: July 21, 2026

## Context

Media processing, scan reconstruction, exports, notifications, and recommendation batches cannot execute reliably inside interactive API requests. Commands and fan-out events have different delivery needs.

## Decision

Use:

- Cloud Tasks for explicitly targeted commands with scheduling, rate control, and bounded retries.
- Pub/Sub for facts consumed by multiple independent subscribers.
- Cloud Run Jobs for finite containerized batch processing.
- Google Cloud Workflows only when a long orchestration benefits from durable visible steps.
- A PostgreSQL transactional outbox to publish events reliably after domain commits.

## Consequences

- Every handler must be idempotent and duplicate-safe.
- Message payloads carry identifiers and references, not large media.
- Dead-letter and terminal-failure behavior is part of each operation design.
- Workflows are not used as a substitute for domain logic.
- Queue and job cost, age, retry, and failure metrics are mandatory.
