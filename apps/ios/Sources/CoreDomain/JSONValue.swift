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
}
