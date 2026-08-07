import Foundation

/// A JSON value carried through unmodified.
///
/// Used where a field's contents are structurally open on the wire and this
/// client must preserve them without modeling every possible shape:
///
/// - `SyncConflictOperationResult.currentRecord` and `SyncChange.record`
///   (`CoreNetworking`'s sync transport), where the value is opaque to the
///   transport layer and re-decoded per record type one level down.
/// - `RecommendationEvidence.factValue` and
///   `RecommendationPriorityFactor.basis` (P7-IOS-01), where the contract
///   deliberately declares open shapes (`factValue: {}`, `basis:
///   additionalProperties: true`) — the engine's stored facts are rendered
///   as readable text by the Today feature, never re-interpreted.
///
/// Lived in `CoreNetworking` as the internal `JSONPassthroughValue` until
/// P7-IOS-01; the recommendation domain models above are what moved it here
/// and made it public — `CoreDomain` cannot import `CoreNetworking`, and a
/// second, duplicated JSON enum would have to be kept byte-identical by
/// review.
public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    /// Parses raw JSON text — used to embed `CoreDomain.OutboxOperation.payload`
    /// (already the exact `SyncOperationPayload` wire shape; see
    /// `FeatureGardens.GardenSyncCommandPayload`'s own doc comment) directly
    /// into a `SyncOperation.payload` request field, with no intermediate
    /// typed re-modeling.
    public init(jsonText: String) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: Data(jsonText.utf8))
    }

    /// Re-serializes to compact JSON text — used for
    /// `CoreDomain.SyncConflict.serverRepresentation`.
    public func jsonText() throws -> String {
        let data = try JSONEncoder().encode(self)
        return String(decoding: data, as: UTF8.self)
    }

    /// This value's own `key` field, when `self` is a JSON object and that
    /// field is a JSON string — used to read `currentRecord.recordType`
    /// without modeling the whole snapshot shape.
    public func stringValue(forKey key: String) -> String? {
        guard case let .object(fields) = self, case let .string(value)? = fields[key] else { return nil }
        return value
    }

    /// This value's own `key` field, whatever its shape — used by
    /// `SyncGateway.getChanges` (P5-IOS-03, Stage 5b) to pull `SyncChange
    /// .record.data` (a `SyncRecordSnapshot`'s per-record-type payload) back
    /// out for a second, typed decode pass, the same way `stringValue(forKey:)`
    /// already pulls out `recordType` alone for push's conflict payload.
    public func value(forKey key: String) -> JSONValue? {
        guard case let .object(fields) = self else { return nil }
        return fields[key]
    }

    /// This value's own fields when it is an object, and an empty dictionary
    /// otherwise — used for a notification's structured template parameters,
    /// where a non-object is a server contract break the client renders
    /// through its generic fallback rather than crashing on.
    public var fields: [String: JSONValue] {
        guard case let .object(fields) = self else { return [:] }
        return fields
    }
}

public extension JSONValue {
    /// A plain rendering for display beside a fact key.
    ///
    /// Numbers drop a trailing `.0` because a resolved fact like "mature
    /// height 900 cm" is read as a measurement, not a floating-point value.
    /// Composite values fall back to a compact description rather than being
    /// hidden — a profile that silently omits a fact it holds is worse than
    /// one that shows it plainly.
    var displayText: String {
        switch self {
        case .null:
            return ""
        case let .bool(value):
            return value ? "true" : "false"
        case let .number(value):
            return value == value.rounded() && value.magnitude < 1e15
                ? String(Int(value))
                : String(value)
        case let .string(value):
            return value
        case let .array(values):
            return values.map(\.displayText).joined(separator: ", ")
        case let .object(values):
            return values
                .sorted { $0.key < $1.key }
                .map { "\($0.key): \($0.value.displayText)" }
                .joined(separator: ", ")
        }
    }
}

