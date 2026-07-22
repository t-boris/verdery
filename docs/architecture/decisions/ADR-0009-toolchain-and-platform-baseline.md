# ADR-0009: Toolchain and Platform Version Baseline

> Status: Accepted  
> Date: July 22, 2026

## Context

The high-level architecture deliberately deferred exact runtime and operating-system versions to
implementation time. [Source: high-level-architecture.md, section "2. Scope"] The architecture
index lists three specific deferrals: minimum iOS and iPadOS versions under a "current major and
supported predecessor" policy, the exact active Firebase-supported Next.js release, and the exact
supported PostgreSQL major version in Cloud SQL. [Source: architecture/README.md, section
"7. Implementation-Time Decisions"]

Work package `P1-REPO-01` cannot create a monorepo, and `P1-DATA-01` cannot create migrations,
until these versions are pinned. Work packages `P0-PLAT-01` and `P0-CLIENT-01` own the decision.

At the time of this decision, Node.js 24 "Krypton" is the active long-term support line, Node.js 22
"Jod" has entered maintenance, and Node.js 26 is the current release that becomes long-term support
in October 2026. The available Apple toolchain is Xcode 26.6 with Swift 6.3, which builds against
the iOS 26 SDK. The available local PostgreSQL client is 17.4.

## Decision

Pin the following baseline. Every version is enforced in repository configuration rather than
documented as a convention only.

| Component               | Version                                  | Enforcement                                                |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Node.js                 | 24 (active LTS)                          | `.nvmrc`, `engines` field, CI matrix                       |
| Package manager         | pnpm 10 workspaces                       | `packageManager` field                                     |
| TypeScript              | 5.9.x                                    | root `tsconfig` and dependency lock                        |
| PostgreSQL              | 17                                       | migration test container, Cloud SQL instance configuration |
| PostGIS                 | 3.5                                      | migration `CREATE EXTENSION` and version assertion         |
| Apple deployment target | iOS 18.0 and iPadOS 18.0                 | Swift package platform declaration                         |
| Apple SDK and language  | iOS 26 SDK, Swift 6.3                    | Xcode project and CI toolchain                             |
| Browser baseline        | last 2 Chrome, Edge, Firefox; Safari 17+ | `browserslist`                                             |

The Apple target follows the documented "current major and supported predecessor" policy: iOS 26 is
the current major and iOS 18 is its supported predecessor.

The exact Next.js release remains pinned by the dependency lock rather than by this ADR, because the
architecture requires "an active Firebase App Hosting-supported release" and that support window
moves independently of this decision.

TypeScript is pinned to 5.9.x rather than to the newest published major. TypeScript 7 is available,
but `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and therefore cannot lint a
TypeScript 7 project. Type checking and linting must agree on one compiler, and the architecture
requires linting and type checking as blocking CI gates. [Source: architecture/testing-strategy.md,
section "22. CI Gates"] TypeScript is revisited when `typescript-eslint` supports the newer major.

## Consequences

- Contributors need Node.js 24 locally; the repository currently builds on a machine running 22 and
  that machine must be upgraded before `pnpm install` matches CI.
- The Node.js 24 support window extends past the 9–12 month foundation planning envelope, so no
  runtime migration is expected before general availability.
- Choosing PostgreSQL 17 matches the locally installed client, so migration tests run without a
  second database installation. Availability of PostgreSQL 17 on Cloud SQL must be confirmed before
  `P1-PLAT-02` provisions an instance; if it is unavailable, this ADR is superseded rather than
  silently adjusted.
- Confirmed during `P1-PLAT-02`: Cloud SQL for PostgreSQL 17 offers PostGIS 3.5.2, 3.6.0, and 3.4.4
  as installable versions, but its _default_ — what a bare `CREATE EXTENSION postgis` installs — is
  3.6.0, not the pinned 3.5. The migration therefore requests `VERSION '3.5.2'` explicitly rather
  than relying on the platform default, which drifted at least once already between the local test
  image and Cloud SQL.
- Targeting iOS 18 rather than iOS 26 requires availability checks around iOS 26-only APIs. This
  cost is accepted in exchange for beta reach, and it is revisited before the AR and LiDAR work in
  Phase 11, where device capability tiers matter more than operating-system reach.
- Dropping below the declared browser baseline requires a new decision, because the Konva map editor
  in Phase 3 depends on Canvas behavior available in that baseline.
