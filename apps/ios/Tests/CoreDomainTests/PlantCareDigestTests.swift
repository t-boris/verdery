import Foundation
import Testing

@testable import CoreDomain

/// What a person sees on opening a plant.
///
/// The rules asserted here are the ones that change a decision if they are
/// wrong: whether "nothing to do" is distinguishable from "we could not ask",
/// whether a decided task outranks the proposal it came from, and whether an
/// unmeasured week is distinguishable from a dry one.
@Suite("Plant care digest")
struct PlantCareDigestTests {
    private let plantId = "plant-1"
    private let otherPlantId = "plant-2"
    private let now = Date(timeIntervalSince1970: 1_780_000_000)

    private func task(
        id: String,
        plantId: String?,
        title: String,
        status: TaskStatus = .planned,
        urgency: TaskUrgency = .normal,
        windowEnd: Date? = nil
    ) -> GardenTask {
        GardenTask(
            id: id,
            gardenId: "garden-1",
            targetKind: plantId == nil ? .garden : .plant,
            targetGardenAreaMapObjectId: nil,
            targetPlantId: plantId,
            title: title,
            notes: nil,
            status: status,
            dueDate: nil,
            timeWindowStart: nil,
            timeWindowEnd: windowEnd,
            recurrenceRule: nil,
            urgency: urgency,
            source: .manual,
            originObservationId: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: now,
            updatedAt: now,
            completedAt: nil,
            assignedProfileId: nil,
            assignedAt: nil,
            completedByProfileId: nil
        )
    }

    private func proposal(
        id: String,
        plantId: String?,
        title: String,
        explanation: String = "Because it has not rained.",
        state: RecommendationState = .presented,
        urgency: TaskUrgency = .normal,
        windowEnd: Date? = nil
    ) -> TodayRecommendation {
        TodayRecommendation(
            recommendation: Recommendation(
                id: id,
                gardenId: "garden-1",
                ruleKey: "watering.dry-spell",
                ruleVersion: 2,
                careCategory: "watering",
                safetyTier: .ordinaryCare,
                state: state,
                urgency: urgency,
                targetKind: plantId == nil ? .garden : .plant,
                targetGardenAreaMapObjectId: nil,
                targetPlantId: plantId,
                windowStart: nil,
                windowEnd: windowEnd,
                explanation: explanation,
                supersedesCandidateId: nil,
                presentedAt: now,
                revision: 1,
                createdAt: now,
                updatedAt: now
            ),
            actionTitle: title,
            priorityScore: 50,
            priorityFactors: [],
            evidence: [],
            targetDisplayName: nil
        )
    }

    private func assemble(
        tasks: [GardenTask] = [],
        proposals: [TodayRecommendation] = [],
        weather: GardenWeather? = nil,
        conditionsUnknown: Bool = false,
        proposalsUnknown: Bool = false
    ) -> PlantCareDigest {
        PlantCareDigests.assemble(
            plantId: plantId,
            tasks: tasks,
            recommendations: proposals,
            weather: weather,
            conditionsUnknown: conditionsUnknown,
            proposalsUnknown: proposalsUnknown
        )
    }

    @Test("keeps only what names this plant")
    func filtersByPlant() {
        let digest = assemble(
            tasks: [
                task(id: "t1", plantId: plantId, title: "Water"),
                task(id: "t2", plantId: otherPlantId, title: "Prune"),
                task(id: "t3", plantId: nil, title: "Rake the whole garden"),
            ],
            proposals: [
                proposal(id: "r1", plantId: plantId, title: "Check watering"),
                proposal(id: "r2", plantId: otherPlantId, title: "Check watering"),
            ]
        )
        #expect(digest.actions.map(\.id) == ["t1", "r1"])
    }

    /// At equal urgency and no deadline, a committed task outranks an open
    /// question. Answering questions is not the first job in a garden.
    @Test("puts a decided task ahead of a proposal at equal urgency")
    func taskOutranksProposal() {
        let digest = assemble(
            tasks: [task(id: "zz-task", plantId: plantId, title: "Stake")],
            proposals: [proposal(id: "aa-proposal", plantId: plantId, title: "Check watering")]
        )
        #expect(digest.actions.map(\.origin) == [.task, .recommendation])
    }

    /// History belongs in the journal, not in a list headed "what to do".
    @Test("drops tasks that are already history")
    func dropsSettledTasks() {
        let digest = assemble(
            tasks: [
                task(id: "t1", plantId: plantId, title: "Water", status: .completed),
                task(id: "t2", plantId: plantId, title: "Feed", status: .skipped),
                task(id: "t3", plantId: plantId, title: "Prune", status: .dismissed),
                task(id: "t4", plantId: plantId, title: "Stake", status: .suggested),
            ]
        )
        #expect(digest.actions.map(\.id) == ["t4"])
    }

    /// Re-offering a decision somebody already made reads as the application
    /// having forgotten.
    @Test("drops suggestions that have already been decided")
    func dropsDecidedProposals() {
        let digest = assemble(
            proposals: [
                proposal(id: "r1", plantId: plantId, title: "Water", state: .completed),
                proposal(id: "r2", plantId: plantId, title: "Feed", state: .rejected),
                proposal(id: "r3", plantId: plantId, title: "Prune", state: .eligible),
            ]
        )
        #expect(digest.actions.map(\.id) == ["r3"])
    }

    /// A recommendation accepted into a task appears as both until the
    /// recommendation's own state catches up. Showing it twice would read as
    /// two jobs.
    @Test("prefers the decided task over the proposal it came from")
    func deduplicatesAcceptedProposal() {
        let digest = assemble(
            tasks: [task(id: "t1", plantId: plantId, title: "Water this rose")],
            proposals: [proposal(id: "r1", plantId: plantId, title: "Water this rose")]
        )
        #expect(digest.actions.map(\.id) == ["t1"])
        #expect(digest.actions.first?.origin == .task)
    }

    @Test("puts the most urgent first, then the soonest deadline")
    func ordersByUrgencyThenDeadline() {
        let soon = now.addingTimeInterval(3600)
        let later = now.addingTimeInterval(86_400)
        let digest = assemble(
            tasks: [
                task(id: "low", plantId: plantId, title: "A", urgency: .low),
                task(id: "urgent", plantId: plantId, title: "B", urgency: .urgent),
                task(id: "highLate", plantId: plantId, title: "C", urgency: .high, windowEnd: later),
                task(id: "highSoon", plantId: plantId, title: "D", urgency: .high, windowEnd: soon),
            ]
        )
        #expect(digest.actions.map(\.id) == ["urgent", "highSoon", "highLate", "low"])
    }

    /// At equal urgency a closing window outranks an open one: a thing with a
    /// deadline is the thing that can be missed.
    @Test("puts a deadline ahead of no deadline at equal urgency")
    func deadlineBeatsNoDeadline() {
        let digest = assemble(
            tasks: [
                task(id: "open", plantId: plantId, title: "A"),
                task(id: "closing", plantId: plantId, title: "B", windowEnd: now),
            ]
        )
        #expect(digest.actions.map(\.id) == ["closing", "open"])
    }

    /// The rule's own stored explanation is what answers "what is this plant
    /// short of", and it must reach the screen unaltered.
    @Test("carries the rule's own explanation through")
    func carriesExplanation() {
        let digest = assemble(
            proposals: [
                proposal(
                    id: "r1",
                    plantId: plantId,
                    title: "Check watering",
                    explanation: "3 mm of rain over the last 7 days."
                )
            ]
        )
        #expect(digest.actions.first?.detail == "3 mm of rain over the last 7 days.")
    }

    /// The distinction the whole card rests on.
    @Test("separates nothing-to-do from could-not-ask")
    func settledIsNotTheSameAsUnknown() {
        #expect(assemble().isSettled)
        #expect(!assemble(proposalsUnknown: true).isSettled)
        // Tasks are offline-capable, so an unreachable suggestion service
        // still leaves the planned work visible.
        let partial = assemble(
            tasks: [task(id: "t1", plantId: plantId, title: "Water")],
            proposalsUnknown: true
        )
        #expect(partial.actions.count == 1)
        #expect(!partial.isSettled)
    }

    @Test("reports weather it could not read apart from weather that is absent")
    func weatherFailureIsNotWeatherAbsence() {
        let unreachable = assemble(conditionsUnknown: true)
        #expect(unreachable.conditionsUnknown)
        #expect(unreachable.weatherUnavailableReason == nil)

        let absent = assemble(
            weather: GardenWeather(
                observation: nil,
                forecast: nil,
                providerConfigured: true,
                attributionText: nil,
                recentRainfall: nil,
                unavailableReason: .gardenNotGeoreferenced
            )
        )
        #expect(!absent.conditionsUnknown)
        #expect(absent.weatherUnavailableReason == .gardenNotGeoreferenced)
        #expect(!absent.hasConditions)
    }
}
