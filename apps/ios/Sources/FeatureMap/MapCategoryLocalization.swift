import CoreDomain
import CoreLocalization

/// Category and category-detail display names.
///
/// A pure `enum → LocalizationKey` mapping, kept separate from
/// `MapAccessibilityLabels.swift` so the exhaustiveness of "every category
/// has a name" is its own test, independent of how a name is assembled into
/// a sentence.
public enum MapCategoryLocalization {
    public static func key(for category: GardenObjectCategory) -> LocalizationKey {
        switch category {
        case .lot: .mapCategoryLot
        case .structure: .mapCategoryStructure
        case .fence: .mapCategoryFence
        case .gate: .mapCategoryGate
        case .path: .mapCategoryPath
        case .zone: .mapCategoryZone
        case .bed: .mapCategoryBed
        case .waterFeature: .mapCategoryWaterFeature
        case .utilityExclusion: .mapCategoryUtilityExclusion
        case .tree: .mapCategoryTree
        case .plant: .mapCategoryPlant
        case .annotation: .mapCategoryAnnotation
        case .importedBackground: .mapCategoryImportedBackground
        }
    }

    public static func name(for category: GardenObjectCategory, strings: LocalizedStrings) -> String {
        strings(key(for: category))
    }

    public static func key(for kind: StructureKind) -> LocalizationKey {
        switch kind {
        case .house: .mapStructureKindHouse
        case .shed: .mapStructureKindShed
        case .greenhouse: .mapStructureKindGreenhouse
        case .deck: .mapStructureKindDeck
        case .garage: .mapStructureKindGarage
        case .other: .mapStructureKindOther
        }
    }

    public static func name(for kind: StructureKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for kind: FenceKind) -> LocalizationKey {
        switch kind {
        case .wood: .mapFenceKindWood
        case .chainLink: .mapFenceKindChainLink
        case .vinyl: .mapFenceKindVinyl
        case .metal: .mapFenceKindMetal
        case .hedge: .mapFenceKindHedge
        case .other: .mapFenceKindOther
        }
    }

    public static func name(for kind: FenceKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for kind: ZoneKind) -> LocalizationKey {
        switch kind {
        case .lawn: .mapZoneKindLawn
        case .garden: .mapZoneKindGarden
        case .mulch: .mapZoneKindMulch
        case .gravel: .mapZoneKindGravel
        case .groundCover: .mapZoneKindGroundCover
        case .other: .mapZoneKindOther
        }
    }

    public static func name(for kind: ZoneKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for kind: BedKind) -> LocalizationKey {
        switch kind {
        case .inGround: .mapBedKindInGround
        case .raised: .mapBedKindRaised
        case .container: .mapBedKindContainer
        }
    }

    public static func name(for kind: BedKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for kind: UtilityExclusionKind) -> LocalizationKey {
        switch kind {
        case .undergroundUtility: .mapUtilityExclusionKindUndergroundUtility
        case .septicField: .mapUtilityExclusionKindSepticField
        case .wellRadius: .mapUtilityExclusionKindWellRadius
        case .setback: .mapUtilityExclusionKindSetback
        case .other: .mapUtilityExclusionKindOther
        }
    }

    public static func name(for kind: UtilityExclusionKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for unit: MeasurementUnit) -> LocalizationKey {
        switch unit {
        case .metres: .mapMeasurementUnitMetres
        case .squareMetres: .mapMeasurementUnitSquareMetres
        case .degrees: .mapMeasurementUnitDegrees
        }
    }

    public static func name(for unit: MeasurementUnit, strings: LocalizedStrings) -> String {
        strings(key(for: unit))
    }
}
