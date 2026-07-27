import Foundation

/// A garden's hemisphere, derived from its current georeference latitude
/// sign — never guessed. `SeasonalPlanResult.hemisphere` is `nil` exactly
/// when the garden has never been georeferenced.
///
/// Source: packages/api-contracts/openapi.yaml, `Hemisphere`.
public enum Hemisphere: String, Codable, Equatable, Sendable, CaseIterable {
    case northern
    case southern
}

/// Every timing/duration column a reviewed `taxonomy_seasonal_fact` row
/// carries. Every field is independently nullable — a crop with no
/// transplant stage, or no known succession benefit, is a fully legitimate
/// fact with those fields `nil`; never a fabricated window.
///
/// Source: packages/api-contracts/openapi.yaml, `SeasonalPlanTaxonomyTiming`.
public struct SeasonalPlanTaxonomyTiming: Equatable, Sendable {
    public let sowIndoorsStartMonth: Int?
    public let sowIndoorsEndMonth: Int?
    public let sowOutdoorsStartMonth: Int?
    public let sowOutdoorsEndMonth: Int?
    public let transplantStartMonth: Int?
    public let transplantEndMonth: Int?
    public let harvestStartMonth: Int?
    public let harvestEndMonth: Int?
    public let daysToMaturityMin: Int?
    public let daysToMaturityMax: Int?
    /// Null = no succession benefit for this crop.
    public let successionIntervalDays: Int?
    /// Null = no known family-conflict rest period.
    public let rotationRestSeasons: Int?

    public init(
        sowIndoorsStartMonth: Int?,
        sowIndoorsEndMonth: Int?,
        sowOutdoorsStartMonth: Int?,
        sowOutdoorsEndMonth: Int?,
        transplantStartMonth: Int?,
        transplantEndMonth: Int?,
        harvestStartMonth: Int?,
        harvestEndMonth: Int?,
        daysToMaturityMin: Int?,
        daysToMaturityMax: Int?,
        successionIntervalDays: Int?,
        rotationRestSeasons: Int?
    ) {
        self.sowIndoorsStartMonth = sowIndoorsStartMonth
        self.sowIndoorsEndMonth = sowIndoorsEndMonth
        self.sowOutdoorsStartMonth = sowOutdoorsStartMonth
        self.sowOutdoorsEndMonth = sowOutdoorsEndMonth
        self.transplantStartMonth = transplantStartMonth
        self.transplantEndMonth = transplantEndMonth
        self.harvestStartMonth = harvestStartMonth
        self.harvestEndMonth = harvestEndMonth
        self.daysToMaturityMin = daysToMaturityMin
        self.daysToMaturityMax = daysToMaturityMax
        self.successionIntervalDays = successionIntervalDays
        self.rotationRestSeasons = rotationRestSeasons
    }
}

/// The `{status: 'reviewed', timing} | {status: 'noSeasonalData'}`
/// discriminated union — present whether the plant's taxon is entirely
/// unknown or simply has no `horticulturally_reviewed` fact for this
/// garden's hemisphere; both collapse to `.noSeasonalData` rather than a
/// silently omitted plant.
///
/// Source: packages/api-contracts/openapi.yaml, `SeasonalPlanTaxonomyStatus`.
public enum SeasonalPlanTaxonomyStatus: Equatable, Sendable {
    case reviewed(SeasonalPlanTaxonomyTiming)
    case noSeasonalData
}

/// One active plant's known taxonomy plus its seasonal timing status — never
/// omitted from `SeasonalPlanResult.plants`, even when `taxonomyReferenceId`
/// is unknown or the taxon has no reviewed fact.
///
/// Source: packages/api-contracts/openapi.yaml, `SeasonalPlanPlantEntry`.
public struct SeasonalPlanPlantEntry: Equatable, Sendable, Identifiable {
    public let plantId: String
    public let taxonomyReferenceId: String?
    public let seasonalFact: SeasonalPlanTaxonomyStatus

    public var id: String { plantId }

    public init(plantId: String, taxonomyReferenceId: String?, seasonalFact: SeasonalPlanTaxonomyStatus) {
        self.plantId = plantId
        self.taxonomyReferenceId = taxonomyReferenceId
        self.seasonalFact = seasonalFact
    }
}

/// One placed plant's continuous bed-rotation state — computed independently
/// of the `crop-rotation-caution` rule's own re-fire cadence. Present for
/// every plant with a known bed placement AND a known own family, including
/// "no known conflict" (`priorFamily` `nil`) and "no configured rest period"
/// (`rotationRestSeasons` `nil`) outcomes — never limited to plants that
/// would currently justify a fired recommendation.
///
/// Source: packages/api-contracts/openapi.yaml, `SeasonalPlanRotationStatusEntry`.
public struct SeasonalPlanRotationStatusEntry: Equatable, Sendable, Identifiable {
    public let plantId: String
    public let gardenAreaMapObjectId: String
    public let family: String
    /// Null = no departed occupant is known within the lookback window, or
    /// the departed occupant's own family is unknown.
    public let priorFamily: String?
    public let priorOccupancyEndedAt: Date?
    /// Null exactly when `priorOccupancyEndedAt` is null.
    public let elapsedDays: Int?
    /// Null = this taxon has no reviewed seasonal fact for this hemisphere,
    /// or the fact configures no rest period.
    public let rotationRestSeasons: Int?
    /// `rotationRestSeasons` converted to elapsed days. Null exactly when
    /// `rotationRestSeasons` is null.
    public let restPeriodThresholdDays: Int?
    /// True only when `priorFamily` matches `family` AND a threshold is
    /// configured AND `elapsedDays` is still below it.
    public let withinRestPeriod: Bool

    public var id: String { plantId }

    public init(
        plantId: String,
        gardenAreaMapObjectId: String,
        family: String,
        priorFamily: String?,
        priorOccupancyEndedAt: Date?,
        elapsedDays: Int?,
        rotationRestSeasons: Int?,
        restPeriodThresholdDays: Int?,
        withinRestPeriod: Bool
    ) {
        self.plantId = plantId
        self.gardenAreaMapObjectId = gardenAreaMapObjectId
        self.family = family
        self.priorFamily = priorFamily
        self.priorOccupancyEndedAt = priorOccupancyEndedAt
        self.elapsedDays = elapsedDays
        self.rotationRestSeasons = rotationRestSeasons
        self.restPeriodThresholdDays = restPeriodThresholdDays
        self.withinRestPeriod = withinRestPeriod
    }
}

/// A garden's whole seasonal plan, exactly as one `getGardenSeasonalPlan`
/// response returned it: a garden-wide, forward-looking read of every
/// reviewed seasonal timing fact for the garden's own plants (every
/// configured window, not only whichever one happens to be open right now)
/// plus the continuous bed-rotation status per placed plant with a known
/// family — distinct from the rule-fired Today/Recommendations set, which
/// only ever surfaces a candidate within its own narrow eligibility window.
///
/// Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`, `SeasonalPlanResult`.
public struct SeasonalPlanResult: Equatable, Sendable {
    public let gardenId: String
    /// Null exactly when the garden has never been georeferenced — the
    /// explicit "we don't know your season" signal.
    public let hemisphere: Hemisphere?
    public let plants: [SeasonalPlanPlantEntry]
    public let rotationStatus: [SeasonalPlanRotationStatusEntry]

    public init(
        gardenId: String,
        hemisphere: Hemisphere?,
        plants: [SeasonalPlanPlantEntry],
        rotationStatus: [SeasonalPlanRotationStatusEntry]
    ) {
        self.gardenId = gardenId
        self.hemisphere = hemisphere
        self.plants = plants
        self.rotationStatus = rotationStatus
    }
}
