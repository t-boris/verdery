import Foundation
import Testing

@testable import CoreDomain
@testable import CoreNetworking

/// P3-QA-01: cross-platform semantic comparison of whole garden-map documents.
///
/// `packages/test-fixtures/fixtures/geometry/map-documents.json` carries five
/// scenarios — small, ordinary, large, pathological, and accessibility —
/// each a set of wire-shaped `GardenObject` entries plus the projection both
/// clients are expected to derive from them.
/// `apps/web/features/map/map-document-fixtures.test.ts` runs the identical
/// fixture through the TypeScript decode path. Passing on both platforms is
/// the actual cross-platform equivalence proof; this file only covers the
/// Swift half. `objects` decodes through `GardenObjectTransport` — the real
/// wire decode path `MapGatewayTests` exercises against inline JSON, here
/// exercised against a much wider variety of categories and shapes than any
/// single hand-written test fixture covers.
@Suite("Map document fixtures")
struct MapDocumentFixtureTests {
    /// Fixture root resolved relative to this file — see `GeometryFixtures.root`
    /// in `CoreDomainTests` for why `#filePath` is used instead of a package
    /// manager path (this Apple package is outside the pnpm workspace).
    private static let fixtureRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Tests/CoreNetworkingTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repository root
        .appendingPathComponent("packages/test-fixtures/fixtures")

    private static func loadFixture() throws -> MapDocumentFixtureFile {
        let url = Self.fixtureRoot.appendingPathComponent("geometry/map-documents.json")
        let data = try Data(contentsOf: url)
        return try Self.wireDecoder.decode(MapDocumentFixtureFile.self, from: data)
    }

    /// `GardenObjectTransport.createdAt`/`updatedAt` are `Date`, and the
    /// default `JSONDecoder` expects a numeric timestamp — this fixture, like
    /// the real server, writes RFC 3339 strings. Mirrors `HTTPTransport`'s
    /// own private decoder exactly (that one isn't reachable here: it's
    /// `private`, not just internal).
    private static var wireDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)

            if let date = ISO8601DateFormatter.withFractionalSeconds.date(from: text) {
                return date
            }
            if let date = ISO8601DateFormatter.withoutFractionalSeconds.date(from: text) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unrecognized date format: \(text)"
            )
        }
        return decoder
    }

    static let fixture = try! Self.loadFixture()

    @Test("covers every garden object category at least once")
    func coversEveryCategory() throws {
        var categories = Set<GardenObjectCategory>()
        for testCase in Self.fixture.cases {
            for wireObject in testCase.objects {
                categories.insert(wireObject.category)
            }
        }
        #expect(categories.count == GardenObjectCategory.allCases.count)
    }

    @Test(
        "decodes every object to the expected projection",
        arguments: Self.fixture.cases
    )
    func decodesToExpectedProjection(_ testCase: MapDocumentFixtureFile.Case) throws {
        let projections = try testCase.objects.map { try ProjectedObject(from: $0.domainValue) }
        #expect(projections == testCase.expected)
    }
}

struct MapDocumentFixtureFile: Decodable, Sendable {
    struct Case: Decodable, Sendable, CustomTestStringConvertible {
        let name: String
        let description: String
        let objects: [GardenObjectTransport]
        let expected: [ProjectedObject]

        var testDescription: String { name }
    }

    let schemaVersion: Int
    let description: String
    let source: String
    let comparison: String
    let cases: [Case]
}

/// The same projection both `MapDocumentFixtureFile.Case.expected` and this
/// file's own decode-and-project step produce — see
/// `apps/web/features/map/map-document-fixtures.test.ts`'s identical
/// `MapDocumentObjectProjection` shape.
struct ProjectedObject: Codable, Equatable, Sendable {
    let id: String
    let category: String
    let geometryType: String
    let coordinateCount: Int
    let label: String?
    let lifecycleState: String
    let detailsCategory: String?
    let detailsFields: JSONFixtureValue?

    init(from object: GardenMapObject) throws {
        id = object.id
        category = object.category.rawValue
        geometryType = object.geometry.type.rawValue
        coordinateCount = object.geometry.positions.count
        label = object.label
        lifecycleState = object.lifecycleState.rawValue
        detailsCategory = object.categoryDetails?.category.rawValue
        detailsFields = try object.categoryDetails.map { try Self.jsonFixtureValue(for: $0) }
    }

    /// The category-specific detail struct's own plain `Codable` encoding —
    /// `{structureKind, heightMetres}`, no `category` key — matching the
    /// fixture's `expected.detailsFields`, and matching what the TypeScript
    /// side compares (`GardenObjectDetails.details`, the nested domain
    /// shape's fields-only half). Deliberately not the flat wire shape
    /// (`GardenObjectDetailsWireCoding`) — that asymmetry is already covered
    /// by `MapGatewayTests`.
    private static func jsonFixtureValue(for details: GardenObjectDetails) throws -> JSONFixtureValue {
        let payload: any Encodable =
            switch details {
            case let .structure(value): value
            case let .fence(value): value
            case let .gate(value): value
            case let .zone(value): value
            case let .bed(value): value
            case let .annotation(value): value
            case let .tree(value): value
            case let .plant(value): value
            case let .utilityExclusion(value): value
            }

        let data = try JSONEncoder().encode(payload)
        return try JSONDecoder().decode(JSONFixtureValue.self, from: data)
    }
}

/// A generic JSON value, for structural comparison of category detail
/// payloads without typing the fixture's `expected.detailsFields` against
/// nine different possible shapes. Dictionary-backed, so key order never
/// affects equality.
indirect enum JSONFixtureValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONFixtureValue])
    case array([JSONFixtureValue])
    case null

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONFixtureValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONFixtureValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value in map document fixture."
            )
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}
