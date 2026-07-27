import Foundation

/// Which aspect of the garden's physical growing environment a fact
/// describes. Matches `context_kind` in the server's own migration
/// exactly — snake_case wire values, not translated to camelCase (the same
/// posture `ClientUpdateState` already takes), so the raw value round-trips
/// unchanged both ways.
///
/// Source: packages/api-contracts/openapi.yaml, `GardenContextKind`.
public enum GardenContextKind: String, Equatable, Sendable, CaseIterable, Codable {
    case sunExposure = "sun_exposure"
    case soilType = "soil_type"
    case drainage
    case irrigationMethod = "irrigation_method"
    case growingContext = "growing_context"
    case microclimate
}

/// How a context fact's value was obtained. `horticulturallyReviewedDefault`
/// additionally requires `reviewedBy`/`reviewedOn` on the same fact.
///
/// Source: packages/api-contracts/openapi.yaml, `GardenContextSource`.
public enum GardenContextSource: String, Equatable, Sendable, CaseIterable, Codable {
    case userDeclared = "user_declared"
    case horticulturallyReviewedDefault = "horticulturally_reviewed_default"
    case imported
}

/// One reviewed or declared fact about a garden's physical growing
/// environment. One row per `(gardenId, contextKind)`; recording the same
/// `contextKind` again updates this same fact in place rather than creating
/// a second one.
///
/// `reviewedBy`/`reviewedOn` are `nil` for every source other than
/// `horticulturallyReviewedDefault` — the wire schema itself declares them
/// independently optional, not narrowed by `source`, so this type follows
/// the same shape rather than asserting an invariant the contract does not
/// enforce.
///
/// Source: packages/api-contracts/openapi.yaml, `GardenContextFact`.
public struct GardenContextFact: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let contextKind: GardenContextKind
    public let value: String
    public let source: GardenContextSource
    /// Human reviewer name or identifier. Present only when `source` is
    /// `horticulturallyReviewedDefault`.
    public let reviewedBy: String?
    /// Calendar date of horticultural sign-off (`yyyy-MM-dd`), kept as a
    /// plain string at this layer — the same latitude `Plant.acquisitionDate`
    /// already takes (`CalendarDate.swift`'s own doc comment). Present only
    /// when `source` is `horticulturallyReviewedDefault`.
    public let reviewedOn: String?
    /// Who declared or imported this fact. Always present, distinct from
    /// `reviewedBy`, a human reviewer name not necessarily tied to a profile.
    public let recordedByProfileId: String
    public let recordedAt: Date
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        contextKind: GardenContextKind,
        value: String,
        source: GardenContextSource,
        reviewedBy: String?,
        reviewedOn: String?,
        recordedByProfileId: String,
        recordedAt: Date,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.contextKind = contextKind
        self.value = value
        self.source = source
        self.reviewedBy = reviewedBy
        self.reviewedOn = reviewedOn
        self.recordedByProfileId = recordedByProfileId
        self.recordedAt = recordedAt
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// A garden's currently recorded context facts, exactly as one
/// `listGardenContextFacts` response returned them — may omit any
/// `GardenContextKind` never yet declared or reviewed; the caller (this
/// screen shows one row per `GardenContextKind` regardless) fills the gap.
///
/// Source: packages/api-contracts/openapi.yaml, `GardenContextFactListResult`.
public struct GardenContextFactListResult: Equatable, Sendable {
    public let items: [GardenContextFact]

    public init(items: [GardenContextFact]) {
        self.items = items
    }
}
