import CoreDomain

/// The joined filters `searchPlants` accepts beyond the plant row's own
/// columns (P11-SEARCH-01).
///
/// A STRUCT RATHER THAN MORE PARAMETERS. `searchPlants` already took six; the
/// six new filters need eight more values, and a fourteen-parameter call is
/// unreadable at every site and unchangeable without touching all of them.
/// Every field defaults to "no restriction", so a caller that wants one filter
/// writes one field.
///
/// JOURNAL RECENCY IS TWO INDEPENDENT BOUNDS, not a range.
/// `notObservedForDays` matches a plant with NO observation at all — "never
/// recorded" is the strongest form of "not recorded lately" and is exactly
/// what a neglect filter is asked for. Callers that offer one control map it
/// to at most one bound; setting both returns nothing and reads as a bug.
///
/// Source: packages/api-contracts/openapi.yaml, operation `searchPlants`.
public struct PlantSearchFilters: Equatable, Sendable {
    public var observedWithinDays: Int?
    public var notObservedForDays: Int?
    public var healthConcern: [ImageAnalysisKind]
    public var seasonalActivity: [TaxonSeasonalActivity]
    public var seasonalMonth: Int?
    public var distributionStatus: [PlantDistributionStatus]
    public var distributionRegion: String?
    public var profileCompleteness: PlantProfileCompleteness?

    public init(
        observedWithinDays: Int? = nil,
        notObservedForDays: Int? = nil,
        healthConcern: [ImageAnalysisKind] = [],
        seasonalActivity: [TaxonSeasonalActivity] = [],
        seasonalMonth: Int? = nil,
        distributionStatus: [PlantDistributionStatus] = [],
        distributionRegion: String? = nil,
        profileCompleteness: PlantProfileCompleteness? = nil
    ) {
        self.observedWithinDays = observedWithinDays
        self.notObservedForDays = notObservedForDays
        self.healthConcern = healthConcern
        self.seasonalActivity = seasonalActivity
        self.seasonalMonth = seasonalMonth
        self.distributionStatus = distributionStatus
        self.distributionRegion = distributionRegion
        self.profileCompleteness = profileCompleteness
    }

    /// Every filter off — what a caller that only wants text search passes.
    public static let none = PlantSearchFilters()

    /// The query-string fragments these filters contribute, already encoded.
    /// Empty collections and blank strings produce nothing: an empty list
    /// means "no restriction", and `?healthConcern=` would say something else.
    var queryItems: [String] {
        var items: [String] = []
        if let observedWithinDays {
            items.append("observedWithinDays=\(observedWithinDays)")
        }
        if let notObservedForDays {
            items.append("notObservedForDays=\(notObservedForDays)")
        }
        if !healthConcern.isEmpty {
            items.append("healthConcern=\(healthConcern.map(\.rawValue).joined(separator: ","))")
        }
        if !seasonalActivity.isEmpty {
            items.append(
                "seasonalActivity=\(seasonalActivity.map(\.rawValue).joined(separator: ","))"
            )
        }
        if let seasonalMonth {
            items.append("seasonalMonth=\(seasonalMonth)")
        }
        if !distributionStatus.isEmpty {
            items.append(
                "distributionStatus=\(distributionStatus.map(\.rawValue).joined(separator: ","))"
            )
        }
        if let distributionRegion,
           !distributionRegion.trimmingCharacters(in: .whitespaces).isEmpty,
           let encoded = distributionRegion
               .trimmingCharacters(in: .whitespaces)
               .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            items.append("distributionRegion=\(encoded)")
        }
        if let profileCompleteness {
            items.append("profileCompleteness=\(profileCompleteness.rawValue)")
        }
        return items
    }
}
