import CoreDomain
import Foundation

/// Wire shapes of the seasonal plan read (P9D-UX-01). See `PlantTransport
/// .swift`'s doc comment for why the enums code by straight synthesis.
///
/// `SeasonalPlanTaxonomyStatusTransport` hand-codes the wire's
/// `{status: 'reviewed', timing} | {status: 'noSeasonalData'}` discriminated
/// union — the same reason `GardenObjectDetailsCoding.swift` hand-codes its
/// own `{category, details}` union; Swift's automatic synthesis for an enum
/// with associated values cannot produce that exact shape.
///
/// Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
struct SeasonalPlanTaxonomyTimingTransport: Decodable {
    let sowIndoorsStartMonth: Int?
    let sowIndoorsEndMonth: Int?
    let sowOutdoorsStartMonth: Int?
    let sowOutdoorsEndMonth: Int?
    let transplantStartMonth: Int?
    let transplantEndMonth: Int?
    let harvestStartMonth: Int?
    let harvestEndMonth: Int?
    let daysToMaturityMin: Int?
    let daysToMaturityMax: Int?
    let successionIntervalDays: Int?
    let rotationRestSeasons: Int?

    var domainValue: SeasonalPlanTaxonomyTiming {
        SeasonalPlanTaxonomyTiming(
            sowIndoorsStartMonth: sowIndoorsStartMonth,
            sowIndoorsEndMonth: sowIndoorsEndMonth,
            sowOutdoorsStartMonth: sowOutdoorsStartMonth,
            sowOutdoorsEndMonth: sowOutdoorsEndMonth,
            transplantStartMonth: transplantStartMonth,
            transplantEndMonth: transplantEndMonth,
            harvestStartMonth: harvestStartMonth,
            harvestEndMonth: harvestEndMonth,
            daysToMaturityMin: daysToMaturityMin,
            daysToMaturityMax: daysToMaturityMax,
            successionIntervalDays: successionIntervalDays,
            rotationRestSeasons: rotationRestSeasons
        )
    }
}

enum SeasonalPlanTaxonomyStatusTransport: Decodable {
    case reviewed(SeasonalPlanTaxonomyTimingTransport)
    case noSeasonalData

    private enum CodingKeys: String, CodingKey {
        case status
        case timing
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(String.self, forKey: .status)

        switch status {
        case "reviewed":
            self = .reviewed(try container.decode(SeasonalPlanTaxonomyTimingTransport.self, forKey: .timing))
        case "noSeasonalData":
            self = .noSeasonalData
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown seasonal fact status: \(status)"
            )
        }
    }

    var domainValue: SeasonalPlanTaxonomyStatus {
        switch self {
        case let .reviewed(timing): .reviewed(timing.domainValue)
        case .noSeasonalData: .noSeasonalData
        }
    }
}

struct SeasonalPlanPlantEntryTransport: Decodable {
    let plantId: String
    let taxonomyReferenceId: String?
    let seasonalFact: SeasonalPlanTaxonomyStatusTransport

    var domainValue: SeasonalPlanPlantEntry {
        SeasonalPlanPlantEntry(
            plantId: plantId,
            taxonomyReferenceId: taxonomyReferenceId,
            seasonalFact: seasonalFact.domainValue
        )
    }
}

struct SeasonalPlanRotationStatusEntryTransport: Decodable {
    let plantId: String
    let gardenAreaMapObjectId: String
    let family: String
    let priorFamily: String?
    let priorOccupancyEndedAt: Date?
    let elapsedDays: Int?
    let rotationRestSeasons: Int?
    let restPeriodThresholdDays: Int?
    let withinRestPeriod: Bool

    var domainValue: SeasonalPlanRotationStatusEntry {
        SeasonalPlanRotationStatusEntry(
            plantId: plantId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            family: family,
            priorFamily: priorFamily,
            priorOccupancyEndedAt: priorOccupancyEndedAt,
            elapsedDays: elapsedDays,
            rotationRestSeasons: rotationRestSeasons,
            restPeriodThresholdDays: restPeriodThresholdDays,
            withinRestPeriod: withinRestPeriod
        )
    }
}

struct SeasonalPlanResultTransport: Decodable {
    let gardenId: String
    let hemisphere: Hemisphere?
    let plants: [SeasonalPlanPlantEntryTransport]
    let rotationStatus: [SeasonalPlanRotationStatusEntryTransport]

    var domainValue: SeasonalPlanResult {
        SeasonalPlanResult(
            gardenId: gardenId,
            hemisphere: hemisphere,
            plants: plants.map(\.domainValue),
            rotationStatus: rotationStatus.map(\.domainValue)
        )
    }
}
