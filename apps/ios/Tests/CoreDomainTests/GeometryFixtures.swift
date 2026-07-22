import Foundation
import Testing

@testable import CoreDomain

/// Loader for the shared, language-neutral geometry fixtures.
///
/// Swift reads the same files as TypeScript and the backend. The fixtures are
/// the reference: when a Swift result differs, the Swift port is wrong.
///
/// Source: architecture/testing-strategy.md, sections "4. Shared Test Assets"
/// and "10. Geometry Equivalence".
enum GeometryFixtures {
    /// Fixture root resolved relative to this file.
    ///
    /// The Apple package is not part of the pnpm workspace, so there is no
    /// package manager that could resolve the fixtures; a repository-relative
    /// path is the only link, and `#filePath` makes it independent of the
    /// working directory a test runner happens to use.
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Tests/CoreDomainTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repository root
        .appendingPathComponent("packages/test-fixtures/fixtures")

    static func load<Fixture: Decodable>(_ relativePath: String) throws -> Fixture {
        let data = try Data(contentsOf: root.appendingPathComponent(relativePath))
        return try JSONDecoder().decode(Fixture.self, from: data)
    }
}

/// A fixture number that JSON cannot express directly.
///
/// The fixture encodes non-finite inputs as strings, because JSON has no literal
/// for them and the rounding contract must still be exercised with them.
enum FixtureNumber: Decodable, Sendable {
    case finite(Double)
    case notANumber
    case positiveInfinity
    case negativeInfinity

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let value = try? container.decode(Double.self) {
            self = .finite(value)
            return
        }

        switch try container.decode(String.self) {
        case "NaN": self = .notANumber
        case "Infinity": self = .positiveInfinity
        case "-Infinity": self = .negativeInfinity
        case let other:
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported numeric literal \(other)."
            )
        }
    }

    var value: Double {
        switch self {
        case let .finite(value): value
        case .notANumber: Double.nan
        case .positiveInfinity: Double.infinity
        case .negativeInfinity: -Double.infinity
        }
    }
}

struct RoundingFixture: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let input: Double
        let expected: Double

        var testDescription: String { name }
    }

    struct RejectedCase: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let input: FixtureNumber
        let reason: String

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let comparison: String
    let cases: [Case]
    let rejectedCases: [RejectedCase]
}

struct ValidationFixture: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let geometry: Geometry
        let expectedCodes: [String]

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let cases: [Case]
}

struct CurveFixture: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let controlPoints: [Position]
        let toleranceMetres: Double
        let expectedPolyline: [Position]

        var testDescription: String { name }
    }

    struct RejectedCase: Decodable, Sendable, CustomTestStringConvertible {
        enum Reason: String, Decodable, Sendable {
            case invalidControlPointCount
            case invalidTolerance
        }

        let name: String
        let controlPoints: [Position]
        let toleranceMetres: Double?
        let reason: Reason

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let comparison: String
    let cases: [Case]
    let rejectedCases: [RejectedCase]
}
