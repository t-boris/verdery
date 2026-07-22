import Foundation

/// A garden's optional real-world anchoring, present only when the owner has
/// georeferenced the garden.
///
/// Deliberately provider-neutral: nothing here names MapKit, a coordinate
/// region, or any other provider type — see the work package's own title,
/// "Integrate optional MapKit context without making canonical garden
/// geometry provider-dependent." A view layer converts ``geographicAnchor``
/// into whatever a specific map provider needs; this type stays a plain
/// WGS84 longitude/latitude pair.
///
/// Source: architecture/map-rendering-and-editing.md; packages/api-contracts/openapi.yaml, `Georeference`.
public struct GardenGeoreference: Equatable, Sendable {
    public let localAnchor: Position
    /// Longitude, latitude — WGS84.
    public let geographicAnchor: Position
    public let rotationDegrees: Double
    public let scaleCorrection: Double
    public let accuracyMetres: Double?
    public let provenance: ProvenanceKind
    public let method: String
    public let revision: Int

    public init(
        localAnchor: Position,
        geographicAnchor: Position,
        rotationDegrees: Double,
        scaleCorrection: Double,
        accuracyMetres: Double? = nil,
        provenance: ProvenanceKind,
        method: String,
        revision: Int
    ) {
        self.localAnchor = localAnchor
        self.geographicAnchor = geographicAnchor
        self.rotationDegrees = rotationDegrees
        self.scaleCorrection = scaleCorrection
        self.accuracyMetres = accuracyMetres
        self.provenance = provenance
        self.method = method
        self.revision = revision
    }
}

/// One entry of a map document's server-computed validation summary.
///
/// Distinct from `CoreDomain.ValidationIssue` (`GeometryValidation.swift`):
/// that type is what the *client* computes locally, keyed by a code plus
/// interpolation parameters for a localized sentence. This type is what the
/// *server* returns alongside a whole document, keyed by which objects and
/// which geometry it concerns — the two never round-trip through the same
/// shape, so they stay two types rather than one overloaded one.
public struct GardenMapValidationIssue: Equatable, Sendable {
    public let code: String
    public let severity: ValidationSeverity
    public let affectedObjectIds: [String]
    /// The offending geometry, when the issue is localizable to a shape
    /// rather than a whole object.
    public let geometry: Geometry?

    public init(
        code: String,
        severity: ValidationSeverity,
        affectedObjectIds: [String] = [],
        geometry: Geometry? = nil
    ) {
        self.code = code
        self.severity = severity
        self.affectedObjectIds = affectedObjectIds
        self.geometry = geometry
    }
}

/// The application's view of `GET /gardens/{gardenId}/map`: every active
/// object in the garden's local coordinate space, its optional georeference,
/// and a validation summary.
///
/// Source: architecture/map-rendering-and-editing.md, section
/// "6. Hybrid Data Model"; packages/api-contracts/openapi.yaml, `GardenMapDocument`.
public struct GardenMapDocument: Equatable, Sendable {
    public let coordinateSpaceId: String
    public let georeference: GardenGeoreference?
    public let objects: [GardenMapObject]
    public let validationSummary: [GardenMapValidationIssue]

    public init(
        coordinateSpaceId: String,
        georeference: GardenGeoreference? = nil,
        objects: [GardenMapObject],
        validationSummary: [GardenMapValidationIssue] = []
    ) {
        self.coordinateSpaceId = coordinateSpaceId
        self.georeference = georeference
        self.objects = objects
        self.validationSummary = validationSummary
    }
}
