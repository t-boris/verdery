import Foundation
import Testing

@testable import CoreDomain

/// The shared `command-inverse.json` fixture, loaded through
/// ``GeometryFixtures``.
///
/// The fixture lives under `packages/test-fixtures/fixtures/geometry/`
/// alongside the geometry fixtures — matching `inverse-command.test.ts`'s own
/// loader — even though the types it exercises live in `Sources/CoreDomain/Map`,
/// not `Sources/CoreDomain/Geometry`.
struct CommandInverseFixture: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let command: MapCommandPayload
        let priorSnapshot: ObjectSnapshot?
        let revisionAfterCommand: Int
        let expectedInverse: MapCommandPayload?

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let comparison: String
    let cases: [Case]
}
