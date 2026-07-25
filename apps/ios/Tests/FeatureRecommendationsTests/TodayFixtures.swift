import CoreDomain
import CoreLocalization
import Foundation

@testable import FeatureRecommendations

/// Shared fixture builders for this target's suites — one canonical Today
/// item shape (plant-targeted, confidence factor carrying a stale-weather
/// basis, two evidence entries) with the knobs each test varies.
enum TodayFixtures {
    static func recommendation(
        id: String = "rec-1",
        urgency: TaskUrgency = .high,
        safetyTier: RecommendationSafetyTier = .ordinaryCare,
        targetKind: TaskTargetKind = .plant,
        targetPlantId: String? = "plant-1",
        windowStart: Date? = Date(timeIntervalSince1970: 1_785_700_000),
        windowEnd: Date? = Date(timeIntervalSince1970: 1_785_900_000),
        explanation: String = "Six dry days in a heat spell.",
        revision: Int = 2
    ) -> Recommendation {
        Recommendation(
            id: id,
            gardenId: "garden-1",
            ruleKey: "watering.deep-soak",
            ruleVersion: 2,
            careCategory: "watering",
            safetyTier: safetyTier,
            state: .presented,
            urgency: urgency,
            targetKind: targetKind,
            targetGardenAreaMapObjectId: nil,
            targetPlantId: targetKind == .plant ? targetPlantId : nil,
            windowStart: windowStart,
            windowEnd: windowEnd,
            explanation: explanation,
            supersedesCandidateId: nil,
            presentedAt: nil,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 1_785_600_000),
            updatedAt: Date(timeIntervalSince1970: 1_785_600_000)
        )
    }

    static func todayItem(
        id: String = "rec-1",
        actionTitle: String = "Deep-soak the tomato bed",
        priorityScore: Int = 72,
        urgency: TaskUrgency = .high,
        safetyTier: RecommendationSafetyTier = .ordinaryCare,
        targetKind: TaskTargetKind = .plant,
        targetDisplayName: String? = "Tomato 'Roma'",
        windowStart: Date? = Date(timeIntervalSince1970: 1_785_700_000),
        windowEnd: Date? = Date(timeIntervalSince1970: 1_785_900_000),
        revision: Int = 2,
        priorityFactors: [RecommendationPriorityFactor]? = nil
    ) -> TodayRecommendation {
        TodayRecommendation(
            recommendation: recommendation(
                id: id,
                urgency: urgency,
                safetyTier: safetyTier,
                targetKind: targetKind,
                windowStart: windowStart,
                windowEnd: windowEnd,
                revision: revision
            ),
            actionTitle: actionTitle,
            priorityScore: priorityScore,
            priorityFactors: priorityFactors ?? [
                RecommendationPriorityFactor(
                    kind: .urgencyWindow,
                    contribution: 40,
                    basis: ["windowEndsInHours": .number(58)]
                ),
                RecommendationPriorityFactor(
                    kind: .confidence,
                    contribution: -8,
                    basis: ["identityConfidence": .number(0.62), "weatherFreshness": .string("stale")]
                ),
            ],
            evidence: [
                RecommendationEvidence(
                    id: "ev-\(id)-1",
                    kind: .weather,
                    sourceObservationId: nil,
                    sourceTaskId: nil,
                    sourcePlantId: nil,
                    sourceWeatherRecordId: "weather-1",
                    factKey: "forecastAgeHours",
                    factValue: .number(26)
                ),
                RecommendationEvidence(
                    id: "ev-\(id)-2",
                    kind: .plantIdentity,
                    sourceObservationId: nil,
                    sourceTaskId: nil,
                    sourcePlantId: "plant-1",
                    sourceWeatherRecordId: nil,
                    factKey: "displayName",
                    factValue: .null
                ),
            ],
            targetDisplayName: targetKind == .plant ? targetDisplayName : nil
        )
    }

    @MainActor
    static func makeModel(
        gateway: FakeRecommendationGateway,
        strings: LocalizedStrings = LocalizedStrings(locale: Locale(identifier: "en_GB"))
    ) -> TodayViewModel {
        TodayViewModel(
            gardenId: "garden-1",
            loadToday: LoadToday(gateway: gateway),
            completeRecommendation: CompleteRecommendation(gateway: gateway),
            postponeRecommendation: PostponeRecommendation(gateway: gateway),
            dismissRecommendation: DismissRecommendation(gateway: gateway),
            markRecommendationIrrelevant: MarkRecommendationIrrelevant(gateway: gateway),
            convertRecommendationToTask: ConvertRecommendationToTask(gateway: gateway),
            strings: strings
        )
    }
}
