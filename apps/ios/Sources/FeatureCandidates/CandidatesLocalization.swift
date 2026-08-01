import CoreDesignSystem
import CoreDomain
import CoreLocalization

/// Display names and tones for the plant-candidate domain's enums, and a
/// pure taxonomy-display-name rule — kept separate from the view models the
/// same way `FeaturePlants.PlantsLocalization` is kept separate from its own
/// view models.
///
/// `groupingKind`/`acquisitionDateType` reuse the contract's shared
/// `PlantGroupingKind`/`PlantAcquisitionDateType` types, but NOT
/// `FeaturePlants.PlantsLocalization`'s own mapping functions — a feature
/// must not import another feature (`architecture/ios-application-design.md`,
/// section "21. Dependency Rules"), so those mappings and
/// `taxonomyDisplayName` are duplicated here, the same "duplicate rather
/// than cross-import" precedent `FeaturePlants.ListGardenMapObjects`'s own
/// doc comment already sets for this class of problem.
public enum CandidatesLocalization {
    public static func key(for kind: PlantGroupingKind) -> PlantCandidatesLocalizationKey {
        switch kind {
        case .individual: .candidatesGroupingKindIndividual
        case .row: .candidatesGroupingKindRow
        case .group: .candidatesGroupingKindGroup
        }
    }

    public static func groupingKindName(_ kind: PlantGroupingKind, strings: LocalizedStrings) -> String {
        strings(key(for: kind))
    }

    public static func key(for type: PlantAcquisitionDateType) -> PlantCandidatesLocalizationKey {
        switch type {
        case .planted: .candidatesAcquisitionDateTypePlanted
        case .sown: .candidatesAcquisitionDateTypeSown
        case .acquired: .candidatesAcquisitionDateTypeAcquired
        }
    }

    public static func acquisitionDateTypeName(_ type: PlantAcquisitionDateType, strings: LocalizedStrings) -> String {
        strings(key(for: type))
    }

    public static func key(for status: PlantCandidateStatus) -> PlantCandidatesLocalizationKey {
        switch status {
        case .active: .candidatesStatusActive
        case .converted: .candidatesStatusConverted
        case .archived: .candidatesStatusArchived
        case .rejected: .candidatesStatusRejected
        }
    }

    public static func statusName(_ status: PlantCandidateStatus, strings: LocalizedStrings) -> String {
        strings(key(for: status))
    }

    /// `active`/`converted` both read as positive (the latter is the
    /// successful terminal state), `rejected` as negative, `archived` as
    /// neutral. Mirrors `apps/web/features/candidates/labels.ts`'s
    /// `candidateStatusTone`.
    public static func tone(for status: PlantCandidateStatus) -> Tone {
        switch status {
        case .active, .converted: .positive
        case .archived: .neutral
        case .rejected: .negative
        }
    }

    public static func key(for priority: PlantCandidatePriority) -> PlantCandidatesLocalizationKey {
        switch priority {
        case .low: .candidatesPriorityLow
        case .medium: .candidatesPriorityMedium
        case .high: .candidatesPriorityHigh
        }
    }

    public static func priorityName(_ priority: PlantCandidatePriority, strings: LocalizedStrings) -> String {
        strings(key(for: priority))
    }

    public static func key(for axis: SuitabilityAxis) -> PlantCandidatesLocalizationKey {
        switch axis {
        case .hardiness: .candidatesSuitabilityAxisHardiness
        case .sunExposure: .candidatesSuitabilityAxisSunExposure
        case .soilPh: .candidatesSuitabilityAxisSoilPh
        case .drainage: .candidatesSuitabilityAxisDrainage
        case .matureSpace: .candidatesSuitabilityAxisMatureSpace
        case .growingContext: .candidatesSuitabilityAxisGrowingContext
        case .structuralConflict: .candidatesSuitabilityAxisStructuralConflict
        case .regulatoryStatus: .candidatesSuitabilityAxisRegulatoryStatus
        case .userPreference: .candidatesSuitabilityAxisUserPreference
        }
    }

    public static func axisName(_ axis: SuitabilityAxis, strings: LocalizedStrings) -> String {
        strings(key(for: axis))
    }

    public static func key(for category: SuitabilityFindingCategory) -> PlantCandidatesLocalizationKey {
        switch category {
        case .match: .candidatesSuitabilityCategoryMatch
        case .caution: .candidatesSuitabilityCategoryCaution
        case .blocker: .candidatesSuitabilityCategoryBlocker
        case .unknown: .candidatesSuitabilityCategoryUnknown
        case .assumption: .candidatesSuitabilityCategoryAssumption
        }
    }

    public static func categoryName(_ category: SuitabilityFindingCategory, strings: LocalizedStrings) -> String {
        strings(key(for: category))
    }

    /// `match` reads as positive, `blocker` as negative; `caution`,
    /// `unknown`, and `assumption` all read as neutral — none of them is a
    /// firm yes or no. Mirrors `apps/web/features/candidates/labels.ts`'s
    /// `suitabilityCategoryTone`.
    public static func tone(for category: SuitabilityFindingCategory) -> Tone {
        switch category {
        case .match: .positive
        case .blocker: .negative
        case .caution, .unknown, .assumption: .neutral
        }
    }

    public static func key(for reason: SuitabilityUnknownReason) -> PlantCandidatesLocalizationKey {
        switch reason {
        case .gardenContextMissing: .candidatesSuitabilityUnknownReasonGardenContextMissing
        case .plantFactMissing: .candidatesSuitabilityUnknownReasonPlantFactMissing
        case .placementMissing: .candidatesSuitabilityUnknownReasonPlacementMissing
        }
    }

    public static func unknownReasonName(_ reason: SuitabilityUnknownReason, strings: LocalizedStrings) -> String {
        strings(key(for: reason))
    }

    /// Common name when set, scientific name otherwise, with the variety
    /// appended in parentheses when present — duplicates
    /// `FeaturePlants.PlantsLocalization.taxonomyDisplayName` verbatim; see
    /// this type's own doc comment for why.
    public static func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        let baseName = reference.commonName?.isEmpty == false ? reference.commonName! : reference.scientificName
        guard let varietyName = reference.varietyName, !varietyName.isEmpty else { return baseName }
        return "\(baseName) (\(varietyName))"
    }

    /// A JSON value carried through unmodified — renders as short readable
    /// text, structure preserved recursively, nothing re-interpreted.
    /// Mirrors `FeatureRecommendations.TodayLocalization.displayText`'s
    /// identical rule for the same problem on a different domain's own
    /// open-shaped fields.
    public static func displayText(_ value: JSONValue) -> String {
        switch value {
        case .null:
            "—"
        case let .bool(flag):
            flag ? "true" : "false"
        case let .number(number):
            numberText(number)
        case let .string(text):
            text
        case let .array(items):
            items.map(displayText).joined(separator: ", ")
        case let .object(fields):
            fields.keys.sorted()
                .map { key in "\(key): \(displayText(fields[key] ?? .null))" }
                .joined(separator: ", ")
        }
    }

    private static func numberText(_ number: Double) -> String {
        number == number.rounded() && abs(number) < 1e15
            ? String(Int(number))
            : String(number)
    }
}
