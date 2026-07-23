import Foundation

/// A JSON value carried through unmodified.
///
/// Used where a field's contents are opaque to this client — today, only
/// `SyncConflictOperationResult.currentRecord` (`packages/api-contracts/openapi.yaml`):
/// this transport layer needs to preserve that value for
/// `CoreDomain.SyncConflict.serverRepresentation` (itself documented as
/// "JSON-encoded and opaque to this layer" — a later stage's conflict
/// recovery UI, P5-CONFLICT-01, is what actually interprets it), without
/// modeling every one of `SyncRecordSnapshot`'s five record-type branches as
/// typed Swift structs here.
enum JSONPassthroughValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONPassthroughValue])
    case object([String: JSONPassthroughValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONPassthroughValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONPassthroughValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")
        }
    }

    func encode(to encoder: Encoder) throws {
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
    init(jsonText: String) throws {
        self = try JSONDecoder().decode(JSONPassthroughValue.self, from: Data(jsonText.utf8))
    }

    /// Re-serializes to compact JSON text — used for
    /// `CoreDomain.SyncConflict.serverRepresentation`.
    func jsonText() throws -> String {
        let data = try JSONEncoder().encode(self)
        return String(decoding: data, as: UTF8.self)
    }

    /// This value's own `key` field, when `self` is a JSON object and that
    /// field is a JSON string — used to read `currentRecord.recordType`
    /// without modeling the whole snapshot shape.
    func stringValue(forKey key: String) -> String? {
        guard case let .object(fields) = self, case let .string(value)? = fields[key] else { return nil }
        return value
    }

    /// This value's own `key` field, whatever its shape — used by
    /// `SyncGateway.getChanges` (P5-IOS-03, Stage 5b) to pull `SyncChange
    /// .record.data` (a `SyncRecordSnapshot`'s per-record-type payload) back
    /// out for a second, typed decode pass, the same way `stringValue(forKey:)`
    /// already pulls out `recordType` alone for push's conflict payload.
    func value(forKey key: String) -> JSONPassthroughValue? {
        guard case let .object(fields) = self else { return nil }
        return fields[key]
    }
}
