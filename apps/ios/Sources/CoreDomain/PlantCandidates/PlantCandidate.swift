import Foundation

/// `converted` is reachable only through `ConvertCandidate` — never through
/// `SetCandidateStatus`, whose own request excludes it.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantCandidateStatus`.
public enum PlantCandidateStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case active
    case converted
    case archived
    case rejected
}

/// Source: packages/api-contracts/openapi.yaml, `PlantCandidatePriority`.
public enum PlantCandidatePriority: String, Codable, Equatable, Sendable, CaseIterable {
    case low
    case medium
    case high
}

/// A plant under consideration for a garden — not yet planted. Distinct from
/// `Plant`, which is actual inventory; `ConvertCandidate` is the one bridge
/// between the two.
///
/// `priceAmount`/`priceCurrency`, `purchaseSource`, `rationaleNote`, and
/// `priority` are the candidate-specific planning fields `Plant` has no
/// equivalent of. `alternativeToCandidateId` is a single, deliberately narrow
/// self-reference — not a full alternatives-set model — per the schema's own
/// description.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantCandidate`.
public struct PlantCandidate: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let proposedGardenAreaMapObjectId: String?
    public let proposedPlacementMapObjectId: String?
    public let displayName: String
    public let taxonomyReferenceId: String?
    public let varietyLabel: String?
    public let groupingKind: PlantGroupingKind
    public let quantity: Int?
    public let status: PlantCandidateStatus
    public let rationaleNote: String?
    public let priority: PlantCandidatePriority?
    public let priceAmount: Double?
    public let priceCurrency: String?
    public let purchaseSource: String?
    public let alternativeToCandidateId: String?
    public let revision: Int
    public let createdByProfileId: String
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        proposedGardenAreaMapObjectId: String?,
        proposedPlacementMapObjectId: String?,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        status: PlantCandidateStatus,
        rationaleNote: String?,
        priority: PlantCandidatePriority?,
        priceAmount: Double?,
        priceCurrency: String?,
        purchaseSource: String?,
        alternativeToCandidateId: String?,
        revision: Int,
        createdByProfileId: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.proposedGardenAreaMapObjectId = proposedGardenAreaMapObjectId
        self.proposedPlacementMapObjectId = proposedPlacementMapObjectId
        self.displayName = displayName
        self.taxonomyReferenceId = taxonomyReferenceId
        self.varietyLabel = varietyLabel
        self.groupingKind = groupingKind
        self.quantity = quantity
        self.status = status
        self.rationaleNote = rationaleNote
        self.priority = priority
        self.priceAmount = priceAmount
        self.priceCurrency = priceCurrency
        self.purchaseSource = purchaseSource
        self.alternativeToCandidateId = alternativeToCandidateId
        self.revision = revision
        self.createdByProfileId = createdByProfileId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
