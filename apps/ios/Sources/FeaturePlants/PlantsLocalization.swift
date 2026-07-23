import CoreDomain
import CoreLocalization

/// Display names for the plant domain's enums, and a pure display-name rule
/// for a taxonomy reference — kept separate from the view models the same
/// way `MapCategoryLocalization` is kept separate from `MapEditorViewModel`.
public enum PlantsLocalization {
    public static func key(for kind: PlantGroupingKind) -> LocalizationKey {
        switch kind {
        case .individual: .plantsGroupingKindIndividual
        case .row: .plantsGroupingKindRow
        case .group: .plantsGroupingKindGroup
        }
    }

    public static func groupingKindName(_ kind: PlantGroupingKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for type: PlantAcquisitionDateType) -> LocalizationKey {
        switch type {
        case .planted: .plantsAcquisitionDateTypePlanted
        case .sown: .plantsAcquisitionDateTypeSown
        case .acquired: .plantsAcquisitionDateTypeAcquired
        }
    }

    public static func acquisitionDateTypeName(_ type: PlantAcquisitionDateType, strings: LocalizedStrings) -> String {
        strings(key(for: type))
    }

    public static func key(for stage: PlantLifecycleStage) -> LocalizationKey {
        switch stage {
        case .planned: .plantsLifecycleStagePlanned
        case .seed: .plantsLifecycleStageSeed
        case .seedling: .plantsLifecycleStageSeedling
        case .transplanted: .plantsLifecycleStageTransplanted
        case .growing: .plantsLifecycleStageGrowing
        case .flowering: .plantsLifecycleStageFlowering
        case .fruiting: .plantsLifecycleStageFruiting
        case .readyToHarvest: .plantsLifecycleStageReadyToHarvest
        }
    }

    public static func lifecycleStageName(_ stage: PlantLifecycleStage, strings: LocalizedStrings) -> String {
        strings(key(for: stage))
    }

    public static func key(for status: PlantStatus) -> LocalizationKey {
        switch status {
        case .active: .plantsStatusActive
        case .dormant: .plantsStatusDormant
        case .archived: .plantsStatusArchived
        case .removed: .plantsStatusRemoved
        case .dead: .plantsStatusDead
        }
    }

    public static func statusName(_ status: PlantStatus, strings: LocalizedStrings) -> String {
        strings(key(for: status))
    }

    /// Common name when set, scientific name otherwise, with the variety
    /// appended in parentheses when present — a pure, localization-free rule
    /// (species names are proper nouns, not translated text), so it is
    /// testable without a `LocalizedStrings` instance.
    public static func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        let baseName = reference.commonName?.isEmpty == false ? reference.commonName! : reference.scientificName
        guard let varietyName = reference.varietyName, !varietyName.isEmpty else { return baseName }
        return "\(baseName) (\(varietyName))"
    }
}
