# ADR-0004: GRDB/SQLite and Application-Owned Offline Synchronization

> Status: Accepted  
> Date: July 21, 2026

## Context

Users must view and edit gardens outdoors with weak or unavailable connectivity. Garden geometry requires domain-specific concurrency and conflict behavior. The system must not lose acknowledged local work.

## Decision

Use SQLite through GRDB as the native local store. Implement an application-owned synchronization protocol using atomic local transactions, a durable outbox, idempotent commands, server revisions, incremental change pulls, and explicit conflict responses.

Do not mirror authoritative data through Firestore. Do not use last-write-wins as the universal conflict strategy.

## Consequences

- The product controls domain conflict semantics and user recovery.
- Sync implementation and testing are a substantial first-class workstream.
- Client-generated UUIDv7 identifiers allow offline creation.
- Media transfer is coordinated with, but not embedded in, the record synchronization protocol.
- The web application is online-first initially and shares server concurrency rules without requiring the native local database.

## Rejected Alternatives

- PowerSync was rejected for the baseline to avoid a critical synchronization dependency and preserve domain-specific control.
- SwiftData was not selected because direct SQLite control, migrations, transaction boundaries, and sync diagnostics are higher priorities.
- Firestore mirroring was rejected to avoid dual authority.
