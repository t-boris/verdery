import Foundation

/// Whether `Plant` tracks a single instance, a row, or a group as one record.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantGroupingKind`.
public enum PlantGroupingKind: String, Codable, Equatable, Sendable, CaseIterable {
    case individual
    case row
    case group
}

/// Source: packages/api-contracts/openapi.yaml, `PlantAcquisitionDateType`.
public enum PlantAcquisitionDateType: String, Codable, Equatable, Sendable, CaseIterable {
    case planted
    case sown
    case acquired
}

/// No ordering is enforced: any stage is reachable from any other, and
/// transitioning to the stage already held is accepted as a legitimate, if
/// inert, command.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantLifecycleStage`.
public enum PlantLifecycleStage: String, Codable, Equatable, Sendable, CaseIterable {
    case planned
    case seed
    case seedling
    case transplanted
    case growing
    case flowering
    case fruiting
    // The wire value is snake_case, unlike every other case here — the
    // contract's own literal, not a convention this client introduces.
    case readyToHarvest = "ready_to_harvest"
}

/// The axis orthogonal to `PlantLifecycleStage`. There is no hard-delete
/// command for a plant — removing one from active inventory is a transition
/// to `removed` or `dead` here.
///
/// Source: packages/api-contracts/openapi.yaml, `PlantStatus`.
public enum PlantStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case active
    case dormant
    case archived
    case removed
    case dead
}

/// A plant instance, row, or group as the application reads it back from the
/// server.
///
/// `acquisitionDate` and the (unmodelled here) task `dueDate` are calendar
/// dates (`format: date`, e.g. `"2026-07-21"`), not timestamps — kept as the
/// contract's own `String` shape rather than `Date` because
/// `CoreNetworking/HTTPTransport.swift`'s single shared `JSONDecoder` already
/// carries one date-decoding strategy for full RFC 3339 timestamps
/// (`createdAt`, `updatedAt`, ...), and a bare calendar date does not parse
/// against that strategy. A calendar date genuinely has no time-of-day or
/// time zone component, so `String` is the honest representation here, not a
/// shortcut around a harder problem.
///
/// Source: architecture/data-and-geospatial-design.md; packages/api-contracts/openapi.yaml, `Plant`.
public struct Plant: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let gardenAreaMapObjectId: String?
    public let placementMapObjectId: String?
    public let displayName: String
    public let taxonomyReferenceId: String?
    public let varietyLabel: String?
    public let acceptedIdentificationId: String?
    public let acquisitionDate: String?
    public let acquisitionDateType: PlantAcquisitionDateType?
    public let groupingKind: PlantGroupingKind
    public let quantity: Int?
    public let lifecycleStage: PlantLifecycleStage
    public let status: PlantStatus
    public let conditionNote: String?
    public let careGuidanceNote: String?
    public let revision: Int
    public let createdByProfileId: String
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        acceptedIdentificationId: String?,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        lifecycleStage: PlantLifecycleStage,
        status: PlantStatus,
        conditionNote: String?,
        careGuidanceNote: String?,
        revision: Int,
        createdByProfileId: String,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.gardenAreaMapObjectId = gardenAreaMapObjectId
        self.placementMapObjectId = placementMapObjectId
        self.displayName = displayName
        self.taxonomyReferenceId = taxonomyReferenceId
        self.varietyLabel = varietyLabel
        self.acceptedIdentificationId = acceptedIdentificationId
        self.acquisitionDate = acquisitionDate
        self.acquisitionDateType = acquisitionDateType
        self.groupingKind = groupingKind
        self.quantity = quantity
        self.lifecycleStage = lifecycleStage
        self.status = status
        self.conditionNote = conditionNote
        self.careGuidanceNote = careGuidanceNote
        self.revision = revision
        self.createdByProfileId = createdByProfileId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
