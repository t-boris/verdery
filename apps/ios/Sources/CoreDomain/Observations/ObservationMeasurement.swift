import Foundation

/// What a measurement measures. A closed set rather than an open key: the
/// value comes straight from a client, and an open one would let this app
/// record something nothing can query.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationMeasurementKind`.
public enum ObservationMeasurementKind: String, Codable, Equatable, Sendable, CaseIterable {
    case height
    case width
    case count
}

/// One typed measurement recorded with an observation (P11-MEDIA-01; design
/// doc §8.1, "Height, width, count, or other typed measurements").
///
/// At most one per kind per observation — `observation_measurement_unique_kind`
/// — because a revised measurement is a correction, and a correction is a new
/// observation rather than an edit to this row.
///
/// `unit` is a free string on the contract with no vocabulary fixed anywhere
/// in this repository, so nothing here invents one.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationMeasurement`.
public struct ObservationMeasurement: Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: ObservationMeasurementKind
    public let value: Double
    public let unit: String
    public let createdAt: Date

    public init(id: String, kind: ObservationMeasurementKind, value: Double, unit: String, createdAt: Date) {
        self.id = id
        self.kind = kind
        self.value = value
        self.unit = unit
        self.createdAt = createdAt
    }
}

/// A measurement being submitted, before the server assigns it an id.
public struct ObservationMeasurementInput: Equatable, Sendable, Identifiable {
    public var kind: ObservationMeasurementKind
    public var value: Double
    public var unit: String

    /// The kind: unique across an observation's measurements by construction,
    /// which is what a list identity needs and what an array index cannot give
    /// once a row is removed.
    public var id: ObservationMeasurementKind { kind }

    public init(kind: ObservationMeasurementKind, value: Double, unit: String) {
        self.kind = kind
        self.value = value
        self.unit = unit
    }
}
