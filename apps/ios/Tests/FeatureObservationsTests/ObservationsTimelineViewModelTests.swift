import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureObservations

@MainActor
@Suite("Observations timeline view model")
struct ObservationsTimelineViewModelTests {
    private func observation(id: String = "obs-1", plantId: String? = "plant-1", isCorrected: Bool = false) -> GardenObservation {
        GardenObservation(
            id: id, gardenId: "garden-1", plantId: plantId, gardenObjectId: nil, actorType: .user,
            createdByProfileId: "profile-1", noteText: "Looking healthy", conditionSummary: nil,
            correctionKind: nil, correctsObservationId: nil, isCorrected: isCorrected,
            observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: []
        )
    }

    private func makeModel(gateway: FakeObservationGateway) -> ObservationsTimelineViewModel {
        ObservationsTimelineViewModel(
            gardenId: "garden-1",
            recordObservation: RecordObservation(gateway: gateway),
            listObservationsForGarden: ListObservationsForGarden(gateway: gateway),
            listObservationsForPlant: ListObservationsForPlant(gateway: gateway),
            correctObservation: CorrectObservation(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load with no filter lists the whole garden's history")
    func loadWithNoFilterListsGarden() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1"), observation(id: "obs-2", plantId: "plant-2")])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 2)
    }

    @Test("load with a plant filter lists only that plant's history")
    func loadWithFilterListsPlantOnly() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1", plantId: "plant-1"), observation(id: "obs-2", plantId: "plant-2")])
        let model = makeModel(gateway: gateway)
        model.plantIdFilter = "plant-1"

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 1)
        #expect(rows.first?.id == "obs-1")
    }

    @Test("clearFilter resets the filter and reloads the garden-wide history")
    func clearFilterReloadsGardenWide() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1", plantId: "plant-1"), observation(id: "obs-2", plantId: "plant-2")])
        let model = makeModel(gateway: gateway)
        model.plantIdFilter = "plant-1"
        await model.load()

        await model.clearFilter()

        #expect(model.plantIdFilter.isEmpty)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 2)
    }

    @Test("submitRecordObservation requires a note or a condition summary")
    func submitRecordRequiresContent() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = ""
        model.recordConditionSummary = ""

        await model.submitRecordObservation()

        #expect(model.recordErrorMessage != nil)
    }

    @Test("submitRecordObservation succeeds with only a note and resets the form")
    func submitRecordSucceedsWithNoteOnly() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "New growth this week"

        await model.submitRecordObservation()

        #expect(model.recordErrorMessage == nil)
        #expect(model.recordNoteText.isEmpty)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state after reload")
            return
        }
        #expect(rows.count == 1)
    }

    @Test("submitCorrection appends a correction row and leaves the original present with isCorrected true")
    func submitCorrectionAppendsRowAndFlagsOriginal() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1")])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.correctingObservationId = "obs-1"

        await model.submitCorrection(kind: .amendment, noteText: "More detail", conditionSummary: nil)

        #expect(model.correctingObservationId == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 2)
        let original = rows.first { $0.id == "obs-1" }
        #expect(original?.isCorrected == true)
        // The original's own content must stay exactly as recorded — a
        // correction never edits it in place.
        #expect(original?.noteText == "Looking healthy")
    }
}
