/// Section 4's structured-input list as the closed evidence vocabulary.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationEvidenceKind`.
public enum RecommendationEvidenceKind: String, Codable, Equatable, Sendable, CaseIterable {
    case plantIdentity = "plant_identity"
    case gardenContext = "garden_context"
    case weather
    case soilMoisture = "soil_moisture"
    case observation
    case task
    case lifecycleStage = "lifecycle_stage"
    case geometryExposure = "geometry_exposure"
    case userPreference = "user_preference"
}

/// One structured fact a recommendation rests on — FR-24's "Evidence used".
///
/// Reference kinds carry exactly their own source id; context kinds carry
/// none. `factValue` is the generation-time value snapshot, `.null` when the
/// referenced row itself is the value — kept as ``JSONValue`` because the
/// contract deliberately leaves the shape open (`factValue: {}`): the
/// engine's stored facts are rendered as readable text, never re-interpreted
/// by this client.
///
/// Source: packages/api-contracts/openapi.yaml, `RecommendationEvidence`.
public struct RecommendationEvidence: Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: RecommendationEvidenceKind
    public let sourceObservationId: String?
    public let sourceTaskId: String?
    public let sourcePlantId: String?
    public let sourceWeatherRecordId: String?
    public let factKey: String
    public let factValue: JSONValue

    public init(
        id: String,
        kind: RecommendationEvidenceKind,
        sourceObservationId: String?,
        sourceTaskId: String?,
        sourcePlantId: String?,
        sourceWeatherRecordId: String?,
        factKey: String,
        factValue: JSONValue
    ) {
        self.id = id
        self.kind = kind
        self.sourceObservationId = sourceObservationId
        self.sourceTaskId = sourceTaskId
        self.sourcePlantId = sourcePlantId
        self.sourceWeatherRecordId = sourceWeatherRecordId
        self.factKey = factKey
        self.factValue = factValue
    }
}
