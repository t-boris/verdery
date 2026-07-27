import CoreDomain
import CoreLocalization
import Foundation

@testable import FeatureSeasonalPlan

/// Shared fixture builders for this target's suites — one canonical
/// `SeasonalPlanResult` shape (a reviewed plant, a `noSeasonalData` plant, a
/// rotation conflict, and a clear rotation entry) with the knobs each test
/// varies.
enum SeasonalPlanFixtures {
    static func timing(
        sowIndoorsStartMonth: Int? = 2,
        sowIndoorsEndMonth: Int? = 3,
        harvestStartMonth: Int? = 7,
        harvestEndMonth: Int? = 9
    ) -> SeasonalPlanTaxonomyTiming {
        SeasonalPlanTaxonomyTiming(
            sowIndoorsStartMonth: sowIndoorsStartMonth,
            sowIndoorsEndMonth: sowIndoorsEndMonth,
            sowOutdoorsStartMonth: nil,
            sowOutdoorsEndMonth: nil,
            transplantStartMonth: nil,
            transplantEndMonth: nil,
            harvestStartMonth: harvestStartMonth,
            harvestEndMonth: harvestEndMonth,
            daysToMaturityMin: 60,
            daysToMaturityMax: 75,
            successionIntervalDays: 14,
            rotationRestSeasons: 2
        )
    }

    static func reviewedPlant(plantId: String = "plant-1", taxonomyReferenceId: String? = "taxon-1") -> SeasonalPlanPlantEntry {
        SeasonalPlanPlantEntry(
            plantId: plantId,
            taxonomyReferenceId: taxonomyReferenceId,
            seasonalFact: .reviewed(timing())
        )
    }

    static func unidentifiedPlant(plantId: String = "plant-2") -> SeasonalPlanPlantEntry {
        SeasonalPlanPlantEntry(plantId: plantId, taxonomyReferenceId: nil, seasonalFact: .noSeasonalData)
    }

    static func conflictEntry(
        plantId: String = "plant-1",
        family: String = "Solanaceae",
        priorFamily: String? = "Solanaceae",
        elapsedDays: Int? = 30,
        restPeriodThresholdDays: Int? = 730
    ) -> SeasonalPlanRotationStatusEntry {
        SeasonalPlanRotationStatusEntry(
            plantId: plantId,
            gardenAreaMapObjectId: "bed-1",
            family: family,
            priorFamily: priorFamily,
            priorOccupancyEndedAt: Date(timeIntervalSince1970: 1_785_000_000),
            elapsedDays: elapsedDays,
            rotationRestSeasons: 2,
            restPeriodThresholdDays: restPeriodThresholdDays,
            withinRestPeriod: true
        )
    }

    static func clearEntry(
        plantId: String = "plant-2",
        family: String = "Brassicaceae",
        priorFamily: String? = nil
    ) -> SeasonalPlanRotationStatusEntry {
        SeasonalPlanRotationStatusEntry(
            plantId: plantId,
            gardenAreaMapObjectId: "bed-2",
            family: family,
            priorFamily: priorFamily,
            priorOccupancyEndedAt: nil,
            elapsedDays: nil,
            rotationRestSeasons: nil,
            restPeriodThresholdDays: nil,
            withinRestPeriod: false
        )
    }

    static func result(
        hemisphere: Hemisphere? = .northern,
        plants: [SeasonalPlanPlantEntry]? = nil,
        rotationStatus: [SeasonalPlanRotationStatusEntry]? = nil
    ) -> SeasonalPlanResult {
        SeasonalPlanResult(
            gardenId: "garden-1",
            hemisphere: hemisphere,
            plants: plants ?? [reviewedPlant(), unidentifiedPlant()],
            rotationStatus: rotationStatus ?? [conflictEntry(), clearEntry()]
        )
    }

    @MainActor
    static func makeModel(
        gateway: FakeSeasonalPlanGateway,
        strings: LocalizedStrings = LocalizedStrings(locale: Locale(identifier: "en_GB"))
    ) -> SeasonalPlanViewModel {
        SeasonalPlanViewModel(
            gardenId: "garden-1",
            loadSeasonalPlan: LoadSeasonalPlan(gateway: gateway),
            strings: strings
        )
    }
}
