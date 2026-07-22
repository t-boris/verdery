# ADR-0002: Firebase and Google Cloud with PostgreSQL/PostGIS Authority

> Status: Accepted  
> Date: July 21, 2026

## Context

The product needs mobile identity, abuse protection, push notifications, diagnostics, web delivery, relational integrity, advanced spatial queries, large media storage, and long-running workers.

## Decision

Use Firebase for Authentication, App Check, Cloud Messaging, Crashlytics, and App Hosting. Use Google Cloud for Cloud Run, Cloud SQL, Cloud Storage, asynchronous processing, networking, and operations. Use PostgreSQL with PostGIS as the only authoritative synchronized domain store.

Firestore is not part of the initial authoritative data path.

## Consequences

- Relational and spatial behavior is modeled directly in PostgreSQL/PostGIS.
- Mobile platform capabilities remain integrated with the Google ecosystem.
- Backend and worker workloads remain portable containers.
- The system must implement an offline synchronization protocol rather than relying on Firestore synchronization.
- Any future Firestore use requires a separate ADR defining projection ownership and consistency.

## Rejected Alternatives

- Firestore-only was rejected because garden geometry, revisions, relationships, and spatial validation fit PostgreSQL/PostGIS better.
- Supabase-first was viable but was not selected because the integrated Firebase and Google Cloud platform was preferred.
- AWS and Azure were rejected as the initial baseline due to greater initial operational complexity without a current enterprise requirement.
