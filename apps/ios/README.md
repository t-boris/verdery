# Verdery — Apple application shell

Work package `P1-IOS-01`. This package is the SwiftUI application shell: structure, wiring, health,
and tests. It contains no garden, plant, map, sync, persistence, or authentication behaviour — those
belong to Phase 2 and later.

The package lives in the monorepo but is deliberately outside the pnpm workspace, per
`docs/architecture/README.md`, section "5. Repository Shape". Swift Package Manager is used instead
of an `.xcodeproj` so that the whole package builds and tests headlessly.

## Build and test

```sh
swift build
swift test
```

Requires the toolchain pinned by ADR-0009: Xcode 26.6 / Swift 6.3, iOS 26 SDK. The deployment target
is iOS and iPadOS 18.0. `macOS 15` is declared as a second platform only so `swift build` and
`swift test` run on a developer machine and in CI; no macOS product ships.

## Modules

| Module              | Responsibility                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| `CoreDomain`        | Platform-neutral meaning: geometry, tolerances, validation, curves       |
| `CoreObservability` | Correlation identifiers and redacted diagnostics                         |
| `CoreLocalization`  | The English and Russian catalogue and the accessor over it               |
| `CoreNetworking`    | Typed API gateway over URLSession, contract error envelope mapping       |
| `FeatureHealth`     | Feature template: use case, view state, view model, SwiftUI view         |
| `AppComposition`    | The single composition root, typed routes, and the root scene            |
| `VerderyApp`        | Entry point; builds the composition root and hands it to the root scene  |

### Dependency rule

Features depend on Core. Core never names a feature, and features never name each other. Only
`AppComposition` knows every layer. Target declarations make an inverted dependency a compile error,
and `Tests/ArchitectureTests` asserts the rule against the manifest so a future edit cannot quietly
relax it.

Source: `docs/architecture/ios-application-design.md`, sections "4. Application Structure",
"5. Layer Responsibilities", and "21. Dependency Rules".

## Geometry equivalence

`CoreDomain/Geometry` is a Swift port of `packages/geometry-contracts`. It is not an approximation:
coordinate rounding, the tolerance constants, the validation issue codes, and cubic Bézier
densification must produce byte-identical results in Swift, TypeScript, and the backend.

`Tests/CoreDomainTests` reads the same JSON files as the TypeScript tests, from
`packages/test-fixtures/fixtures/geometry/`, resolved relative to this package. The fixtures declare
exact comparison, so a one-unit-in-the-last-place disagreement is a hard failure rather than
something to tune. When Swift and a fixture disagree, the Swift port is wrong.

Source: `docs/architecture/testing-strategy.md`, section "10. Geometry Equivalence"; ADR-0010.

## Localization

`Sources/CoreLocalization/Resources/{en,ru}.lproj/Localizable.strings`. English is the development
language. Placeholders are named (`{version}`) rather than positional so that a translator can
reorder a sentence freely. Tests assert that both languages define the same keys, that every geometry
validation code has an entry, and that the catalogue carries no entry nothing refers to.

## Networking

`CoreNetworking` hand-writes only the health operations. Broader operations are generated from
`packages/api-contracts/openapi.yaml` in a later work package and stay behind a gateway of this
shape, so no feature ever sees a generated type or URLSession.

`/v1/health/ready` answers `503` with the same body when the service is not ready, so an unready
service is a decoded value rather than a thrown error. Every other rejected status is decoded as the
contract error envelope and mapped to `APIGatewayError`.

### Known gap

The OpenAPI document names `Idempotency-Key` and `If-Match` but does not yet name a request
correlation header; it only returns `correlationId` in the error envelope. The client sends
`X-Correlation-Id` as a provisional convention, replaced by the contract's name when `P1-OBS-01`
pins it.
