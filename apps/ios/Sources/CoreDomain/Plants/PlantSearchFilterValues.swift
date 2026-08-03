/// The closed vocabularies P11-SEARCH-01's joined plant filters range over.
///
/// `ImageAnalysisKind` is NOT redeclared here — it already exists in
/// `Observations/ObservationPhoto.swift`, and a second copy would be a second
/// thing to keep in step with the same OpenAPI enum.
///
/// Source: packages/api-contracts/openapi.yaml, schemas
/// `TaxonSeasonalActivity`, `PlantDistributionStatus`, and
/// `PlantProfileCompleteness`.

/// The seasonal windows a taxon records. Crop-oriented rather than botanical:
/// these are moments a gardener acts, not the plant's own bloom and fruit
/// phenology, which no current source populates.
public enum TaxonSeasonalActivity: String, Codable, Equatable, Sendable, CaseIterable {
    case sowIndoors = "sow_indoors"
    case sowOutdoors = "sow_outdoors"
    case transplant
    case harvest
}

/// A taxon's standing in a named region. `regulated` is a legal state and
/// `invasive` an ecological one; they overlap often but neither implies the
/// other, so both are asserted independently.
public enum PlantDistributionStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case native
    case introduced
    case invasive
    case regulated
}

/// How much of a taxon's knowledge profile has been materialized. `none` is
/// not a degenerate `partial`: it means enrichment has never produced a
/// profile, the ordinary state for anything the pipeline has not reached.
public enum PlantProfileCompleteness: String, Codable, Equatable, Sendable, CaseIterable {
    case complete
    case partial
    case none
}
