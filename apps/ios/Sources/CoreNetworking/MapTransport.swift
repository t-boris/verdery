import CoreDomain
import Foundation

/// Wire shapes of the map operations.
///
/// These types stay internal — the architecture requires generated or
/// transport models to remain behind the application gateway — the same
/// reason `GardenTransport.swift` exists. Every field name here matches
/// `packages/api-contracts/openapi.yaml` exactly, so every one of these
/// structs codes by straight synthesis; only `MapCommandRequestTransport`'s
/// `payload` member leans on `CoreDomain.MapCommandPayload`'s own
/// hand-written coding, and `GardenObjectTransport.details` on
/// `CoreDomain.GardenObjectDetailsWireCoding` (both flat on the wire,
/// `{"category": ..., "structureKind": ..., ...}` — not `CoreDomain`'s own
/// nested `GardenObjectDetails` `Codable` conformance, which exists for
/// local undo-stack bookkeeping only. Confirmed against the real server
/// during this work package; see `GardenObjectDetailsWireCoding`'s doc
/// comment for the full story.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Map`.
struct GeometryEnvelopeTransport: Codable {
    let geometry: Geometry
    let coordinateSpaceId: String
    let coordinateSpaceKind: CoordinateSpaceKind
    let provenance: ProvenanceKind
    let curve: CurveMetadata?
    let confidence: Double?
}

struct GardenObjectTransport: Codable {
    let id: String
    let gardenId: String
    let category: GardenObjectCategory
    let geometryEnvelope: GeometryEnvelopeTransport
    let label: String?
    let details: GardenObjectDetails?
    let lifecycleState: ObjectLifecycleState
    let revision: Int
    let createdAt: Date
    let updatedAt: Date

    private enum CodingKeys: String, CodingKey {
        case id, gardenId, category, geometryEnvelope, label, details
        case lifecycleState, revision, createdAt, updatedAt
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        gardenId = try container.decode(String.self, forKey: .gardenId)
        category = try container.decode(GardenObjectCategory.self, forKey: .category)
        geometryEnvelope = try container.decode(
            GeometryEnvelopeTransport.self, forKey: .geometryEnvelope
        )
        label = try container.decodeIfPresent(String.self, forKey: .label)
        details =
            container.contains(.details)
            ? try GardenObjectDetailsWireCoding.decode(
                from: container.superDecoder(forKey: .details)
            )
            : nil
        lifecycleState = try container.decode(ObjectLifecycleState.self, forKey: .lifecycleState)
        revision = try container.decode(Int.self, forKey: .revision)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(gardenId, forKey: .gardenId)
        try container.encode(category, forKey: .category)
        try container.encode(geometryEnvelope, forKey: .geometryEnvelope)
        try container.encodeIfPresent(label, forKey: .label)
        if let details {
            try GardenObjectDetailsWireCoding.encode(
                details, to: container.superEncoder(forKey: .details)
            )
        }
        try container.encode(lifecycleState, forKey: .lifecycleState)
        try container.encode(revision, forKey: .revision)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

struct GeoreferenceTransport: Codable {
    let localAnchor: Position
    let geographicAnchor: Position
    let rotationDegrees: Double
    let scaleCorrection: Double
    let accuracyMetres: Double?
    let provenance: ProvenanceKind
    let method: String
    let revision: Int
}

struct ValidationIssueTransport: Codable {
    let code: String
    let severity: ValidationSeverity
    let affectedObjectIds: [String]?
    let geometry: Geometry?
}

struct GardenMapDocumentTransport: Decodable {
    let coordinateSpaceId: String
    let georeference: GeoreferenceTransport?
    let objects: [GardenObjectTransport]
    let validationSummary: [ValidationIssueTransport]
}

/// The request body of `POST /gardens/{gardenId}/map/commands`.
///
/// `gardenId`, `actorProfileId`, and `actorType` — three of the five fields
/// `CoreDomain.MapCommandEnvelope` models — are deliberately absent: the
/// operation description is explicit that the server fills actor identity
/// from the authenticated caller and never reads it from the body, and
/// `gardenId` is already the URL path parameter. Sending a body that only
/// carries what the wire contract actually declares is why this is its own
/// transport struct rather than a reuse of `MapCommandEnvelope`.
struct MapCommandRequestTransport: Encodable {
    let commandId: String
    let clientTimestamp: String
    let payload: MapCommandPayload

    private enum CodingKeys: String, CodingKey {
        case commandId, clientTimestamp, payload
    }

    /// `payload` encodes through `MapCommandWireCoding`, not
    /// `MapCommandPayload`'s own `Codable` conformance — see that type's doc
    /// comment for why the two must differ.
    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(clientTimestamp, forKey: .clientTimestamp)
        try MapCommandWireCoding.encode(payload, to: container.superEncoder(forKey: .payload))
    }
}

struct MapCommandResultTransport: Decodable {
    let affectedObjects: [GardenObjectTransport]
}

extension GardenObjectTransport {
    var domainValue: GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: gardenId,
            category: category,
            geometry: geometryEnvelope.geometry,
            coordinateSpaceId: geometryEnvelope.coordinateSpaceId,
            label: label,
            categoryDetails: details,
            lifecycleState: lifecycleState,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

extension GeoreferenceTransport {
    var domainValue: GardenGeoreference {
        GardenGeoreference(
            localAnchor: localAnchor,
            geographicAnchor: geographicAnchor,
            rotationDegrees: rotationDegrees,
            scaleCorrection: scaleCorrection,
            accuracyMetres: accuracyMetres,
            provenance: provenance,
            method: method,
            revision: revision
        )
    }
}

extension ValidationIssueTransport {
    var domainValue: GardenMapValidationIssue {
        GardenMapValidationIssue(
            code: code,
            severity: severity,
            affectedObjectIds: affectedObjectIds ?? [],
            geometry: geometry
        )
    }
}

extension GardenMapDocumentTransport {
    var domainValue: GardenMapDocument {
        GardenMapDocument(
            coordinateSpaceId: coordinateSpaceId,
            georeference: georeference?.domainValue,
            objects: objects.map(\.domainValue),
            validationSummary: validationSummary.map(\.domainValue)
        )
    }
}

extension MapCommandResultTransport {
    var domainValue: MapCommandResult {
        MapCommandResult(affectedObjects: affectedObjects.map(\.domainValue))
    }
}
