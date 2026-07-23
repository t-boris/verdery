/// One field's value in a partial (`PATCH`-style) update request.
///
/// Several contract request bodies — `UpdatePlantDetailsRequest`,
/// `EditTaskRequest`, `RescheduleTaskRequest` — document the same rule for
/// their nullable properties: "an omitted property leaves the current value
/// unchanged, while an explicit `null` on a nullable property clears it."
/// A plain `Value?` cannot express that: `nil` would have to mean both
/// "omit" and "clear," which is exactly the ambiguity this type exists to
/// remove. `.unchanged` omits the JSON key entirely; `.set(nil)` encodes an
/// explicit `null`; `.set(value)` encodes the value.
///
/// Every request transport with a field of this shape gives that field a
/// custom `encode(to:)` — see `PlantTransport.swift`'s
/// `UpdatePlantDetailsRequestTransport` for the pattern.
///
/// Source: packages/api-contracts/openapi.yaml, `UpdatePlantDetailsRequest`,
/// `EditTaskRequest`, `RescheduleTaskRequest`.
public enum FieldUpdate<Value: Sendable>: Sendable {
    case unchanged
    case set(Value?)
}

extension FieldUpdate: Equatable where Value: Equatable {}

extension KeyedEncodingContainer {
    /// Encodes a ``FieldUpdate`` under `key`: omits the key for `.unchanged`,
    /// encodes `null` for `.set(nil)`, encodes the value for `.set(value)`.
    public mutating func encode<Value: Encodable>(
        _ fieldUpdate: FieldUpdate<Value>,
        forKey key: Key
    ) throws {
        switch fieldUpdate {
        case .unchanged:
            return
        case .set(nil):
            try encodeNil(forKey: key)
        case let .set(value?):
            try encode(value, forKey: key)
        }
    }
}
