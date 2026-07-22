# ADR-0001: Monorepo with Separate Native and Web Clients

> Status: Accepted  
> Date: July 21, 2026

## Context

Grow Garden requires a native Apple application with AR, sensor, background-upload, and offline capabilities, plus a first-class web application optimized for large-screen map editing. Both clients depend on the same API, geometry semantics, localization, and test fixtures.

## Decision

Use one repository containing a native Swift/SwiftUI client and a separate TypeScript/React client. Do not share presentation code. Share machine-readable contracts, schemas, fixtures, and localization sources where this does not force a shared runtime.

## Consequences

- Product, API, infrastructure, and documentation changes can be reviewed together.
- Native platform capabilities remain first class.
- Web and iOS releases remain independently deployable.
- CI must avoid rebuilding unaffected surfaces unnecessarily.
- JavaScript workspace tools must not own or rewrite the Xcode project.

## Rejected Alternatives

- Cross-platform UI frameworks were rejected because the Apple capture experience depends heavily on native frameworks.
- Multiple repositories were rejected for the initial team because they increase contract and documentation drift.
