/// Category-specific detail payloads.
///
/// Categories without a case here (lot, path, waterFeature, importedBackground)
/// carry no specialized fields beyond the common `garden_object` shape.
///
/// Every detail struct is `Codable` by straight synthesis: its Swift property
/// names already match the JSON field names, so nothing here needs
/// hand-written coding. Only ``GardenObjectDetails`` itself — the
/// `{category, details}` discriminated union — does; see
/// `GardenObjectDetailsCoding.swift`.
///
/// Source: architecture/map-rendering-and-editing.md, section
/// "4. Canonical Object Categories"; architecture/data-and-geospatial-design.md,
/// section "7. Garden Object Model"; packages/geometry-contracts/src/object-category.ts.

public enum StructureKind: String, Codable, Sendable, CaseIterable {
    case house
    case shed
    case greenhouse
    case deck
    case garage
    case other
}

public struct StructureDetails: Equatable, Sendable, Codable {
    public let structureKind: StructureKind
    public let heightMetres: Double?

    public init(structureKind: StructureKind, heightMetres: Double? = nil) {
        self.structureKind = structureKind
        self.heightMetres = heightMetres
    }
}

public enum FenceKind: String, Codable, Sendable, CaseIterable {
    case wood
    case chainLink
    case vinyl
    case metal
    case hedge
    case other
}

public struct FenceDetails: Equatable, Sendable, Codable {
    public let fenceKind: FenceKind
    public let heightMetres: Double?

    public init(fenceKind: FenceKind, heightMetres: Double? = nil) {
        self.fenceKind = fenceKind
        self.heightMetres = heightMetres
    }
}

/// A gate is always positioned along exactly one fence.
public struct GateDetails: Equatable, Sendable, Codable {
    public let fenceObjectId: String
    public let widthMetres: Double?

    public init(fenceObjectId: String, widthMetres: Double? = nil) {
        self.fenceObjectId = fenceObjectId
        self.widthMetres = widthMetres
    }
}

public enum ZoneKind: String, Codable, Sendable, CaseIterable {
    case lawn
    case garden
    case mulch
    case gravel
    case groundCover
    case other
}

public struct ZoneDetails: Equatable, Sendable, Codable {
    public let zoneKind: ZoneKind

    public init(zoneKind: ZoneKind) {
        self.zoneKind = zoneKind
    }
}

public enum BedKind: String, Codable, Sendable, CaseIterable {
    case inGround
    case raised
    case container
}

public struct BedDetails: Equatable, Sendable, Codable {
    public let bedKind: BedKind
    public let soilNotes: String?

    public init(bedKind: BedKind, soilNotes: String? = nil) {
        self.bedKind = bedKind
        self.soilNotes = soilNotes
    }
}

public struct TreeDetails: Equatable, Sendable, Codable {
    /// Absent until the user draws or accepts a canopy outline.
    public let canopyGeometry: Geometry?
    public let commonName: String?
    public let estimatedHeightMetres: Double?
    public let estimatedSpreadMetres: Double?

    public init(
        canopyGeometry: Geometry? = nil,
        commonName: String? = nil,
        estimatedHeightMetres: Double? = nil,
        estimatedSpreadMetres: Double? = nil
    ) {
        self.canopyGeometry = canopyGeometry
        self.commonName = commonName
        self.estimatedHeightMetres = estimatedHeightMetres
        self.estimatedSpreadMetres = estimatedSpreadMetres
    }
}

/// Deliberately without a plant-catalog reference — see the module doc comment.
public struct PlantPlacementDetails: Equatable, Sendable, Codable {
    public let commonName: String
    /// More than one for a grouped planting sharing one geometry.
    public let quantity: Int
    public let spacingMetres: Double?
    /// The zone or bed object this plant is assigned to, if any.
    public let assignedToObjectId: String?

    public init(
        commonName: String,
        quantity: Int,
        spacingMetres: Double? = nil,
        assignedToObjectId: String? = nil
    ) {
        self.commonName = commonName
        self.quantity = quantity
        self.spacingMetres = spacingMetres
        self.assignedToObjectId = assignedToObjectId
    }
}

public enum UtilityExclusionKind: String, Codable, Sendable, CaseIterable {
    case undergroundUtility
    case septicField
    case wellRadius
    case setback
    case other
}

public struct UtilityExclusionDetails: Equatable, Sendable, Codable {
    public let utilityExclusionKind: UtilityExclusionKind
    public let notes: String?

    public init(utilityExclusionKind: UtilityExclusionKind, notes: String? = nil) {
        self.utilityExclusionKind = utilityExclusionKind
        self.notes = notes
    }
}

/// The "Annotation and measurement reference" category (section 4) is where a
/// ``Measurement`` attaches — an ordinary object's length or area is derived
/// from its geometry at render time, not stored, so only a dedicated
/// measurement reference needs this table.
public struct AnnotationDetails: Equatable, Sendable, Codable {
    public let measurement: Measurement?

    public init(measurement: Measurement? = nil) {
        self.measurement = measurement
    }
}

/// The category-specific detail payload for a category that has one.
///
/// Categories without a case here (lot, path, waterFeature, importedBackground)
/// carry no specialized fields beyond the common `garden_object` shape.
public enum GardenObjectDetails: Equatable, Sendable {
    case structure(StructureDetails)
    case fence(FenceDetails)
    case gate(GateDetails)
    case zone(ZoneDetails)
    case bed(BedDetails)
    case annotation(AnnotationDetails)
    case tree(TreeDetails)
    case plant(PlantPlacementDetails)
    case utilityExclusion(UtilityExclusionDetails)

    public var category: GardenObjectCategory {
        switch self {
        case .structure: .structure
        case .fence: .fence
        case .gate: .gate
        case .zone: .zone
        case .bed: .bed
        case .annotation: .annotation
        case .tree: .tree
        case .plant: .plant
        case .utilityExclusion: .utilityExclusion
        }
    }
}
