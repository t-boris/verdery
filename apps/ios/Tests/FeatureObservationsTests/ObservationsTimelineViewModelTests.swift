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

    private func observationWithAnalysisResult(
        analysisResultId: String = "analysis-1",
        disposition: HealthSuggestionDisposition = .unresolved
    ) -> GardenObservation {
        let result = ImageAnalysisResult(
            id: analysisResultId,
            analysisKind: .disease,
            suggestedLabel: "Possible leaf spot",
            confidenceScore: 0.6,
            requiresConfirmation: true,
            requestedAdditionalEvidence: false,
            evidenceSummary: "Brown spotting on lower leaves.",
            alternativeExplanations: ["Nutrient deficiency"],
            safetyClass: .monitor,
            requestedViewPurposes: [],
            modelName: "gemini-test",
            promptVersion: 3,
            disposition: disposition,
            dispositionSetAt: nil,
            dispositionSetByProfileId: nil,
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let photo = ObservationPhoto(
            id: "photo-1", mediaId: "media-1", purpose: .wholePlant,
            createdAt: Date(timeIntervalSince1970: 0), analysisResults: [result]
        )
        return GardenObservation(
            id: "obs-1", gardenId: "garden-1", plantId: "plant-1", gardenObjectId: nil, actorType: .user,
            createdByProfileId: "profile-1", noteText: nil, conditionSummary: "Leaves look off",
            correctionKind: nil, correctsObservationId: nil, isCorrected: false,
            observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: [photo]
        )
    }

    private func makeModel(
        gateway: FakeObservationGateway,
        localStore: any LocalObservationStore = InMemoryObservationStore()
    ) -> ObservationsTimelineViewModel {
        ObservationsTimelineViewModel(
            gardenId: "garden-1",
            recordObservation: RecordObservation(localStore: localStore, profileId: "profile-1"),
            listObservationsForGarden: ListObservationsForGarden(gateway: gateway, localStore: localStore),
            listObservationsForPlant: ListObservationsForPlant(gateway: gateway),
            correctObservation: CorrectObservation(localStore: localStore, profileId: "profile-1"),
            setHealthSuggestionDisposition: SetHealthSuggestionDisposition(gateway: gateway),
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

        // The new row names the observation it corrects, both on the row
        // itself and in the composed label the view renders.
        let correction = rows.first { $0.id != "obs-1" }
        #expect(correction?.correctsObservationId == "obs-1")
        #expect(correction.flatMap(model.correctionOfText) == "Amendment of observation obs-1")
    }

    @Test("correctionOfText is nil for a row that is not itself a correction")
    func correctionOfTextNilForNonCorrectionRow() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1")])
        let model = makeModel(gateway: gateway)
        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(model.correctionOfText(for: rows[0]) == nil)
    }

    // MARK: - Offline routing (P5-IOS-02, Stage 4d)

    @Test("A recorded observation returns the shot purpose to the default instead of carrying it over")
    func recordPhotoPurposeResetsAfterSubmit() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "Spotting on one leaf"
        model.recordPhotoPurpose = .symptomCloseUp

        await model.submitRecordObservation()

        // Inheriting the previous entry's label would quietly file the next
        // photograph — likely an ordinary progress shot — into the symptom
        // sequence, where nothing downstream could tell it did not belong.
        #expect(model.recordPhotoPurpose == .wholePlant)
    }

    @Test("submitRecordObservation never reaches the gateway — the recorded observation exists only locally")
    func submitRecordNeverCallsGateway() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "New growth this week"

        await model.submitRecordObservation()

        // `FakeObservationGateway` never learned about this observation — if
        // `RecordObservation` had called through to it, `listObservationsForGarden`
        // (which reads the same in-memory array `recordObservation` would
        // have appended to) would return it too.
        let confirmed = try? await gateway.listObservationsForGarden(gardenId: "garden-1")
        #expect(confirmed?.isEmpty == true)
    }

    @Test("load falls back to locally pending observations when the network is unreachable")
    func loadFallsBackToPendingWhenOffline() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "Recorded while offline"
        await model.submitRecordObservation()

        gateway.nextListFailure = APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "test-offline")

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state, falling back to the pending row")
            return
        }
        #expect(rows.count == 1)
        #expect(rows.first?.noteText == "Recorded while offline")
        #expect(rows.first?.isPendingSync == true)
    }

    @Test("load still fails when the network is unreachable and nothing is pending locally")
    func loadStillFailsWhenOfflineWithNoPendingRows() async {
        let gateway = FakeObservationGateway()
        gateway.nextListFailure = APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "test-offline")
        let model = makeModel(gateway: gateway)

        await model.load()

        // An empty pending set on a transport failure means "unknown," not
        // "confirmed empty" — `.loaded([])` here would misreport an offline
        // device as having verified there is nothing to show.
        guard case .failed = model.state else {
            Issue.record("Expected a failed state")
            return
        }
    }

    /// The core Stage 4d rendering requirement: a correction recorded while
    /// the network is unreachable must still show its "corrects observation
    /// X" relationship, and must still mark the observation it corrects
    /// "Corrected" — using data recomputed entirely from local storage, with
    /// no network round trip involved anywhere in this test.
    @Test("a correction of a purely offline-recorded observation displays its correction relationship while the network is unreachable")
    func correctionOfOfflineObservationDisplaysRelationshipWhileOffline() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "Recorded offline"
        await model.submitRecordObservation()

        guard case let .loaded(initialRows) = model.state, let recorded = initialRows.first else {
            Issue.record("Expected the freshly recorded observation to be visible")
            return
        }

        gateway.nextListFailure = APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "test-offline")
        model.correctingObservationId = recorded.id

        await model.submitCorrection(kind: .amendment, noteText: "Correcting while still offline", conditionSummary: nil)

        #expect(model.correctionErrorMessage == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 2)

        let original = rows.first { $0.id == recorded.id }
        #expect(original?.isCorrected == true)
        #expect(original?.isPendingSync == true)
        // The original's own content stays exactly as recorded.
        #expect(original?.noteText == "Recorded offline")

        let correction = rows.first { $0.id != recorded.id }
        #expect(correction?.correctsObservationId == recorded.id)
        #expect(correction?.isPendingSync == true)
        #expect(correction.flatMap(model.correctionOfText) == "Amendment of observation \(recorded.id)")
    }

    /// The honest boundary of what a purely local, no-cache-of-confirmed-
    /// rows design can show while offline: correcting a *server-confirmed*
    /// observation this device never cached leaves that original with
    /// nothing to display it from once the network fails — but the new
    /// correction itself still displays correctly, including which
    /// observation it names, which is the property this stage's own scope
    /// (`ObservationsTimelineViewModel`'s own doc comment: no local cache of
    /// server-confirmed rows) actually calls for.
    @Test("correcting a server-confirmed observation while offline shows the correction but not the uncached original")
    func correctionOfServerObservationWhileOfflineOmitsUncachedOriginal() async {
        let gateway = FakeObservationGateway(observations: [observation(id: "obs-1")])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.correctingObservationId = "obs-1"
        gateway.nextListFailure = APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "test-offline")

        await model.submitCorrection(kind: .amendment, noteText: "Correcting offline", conditionSummary: nil)

        #expect(model.correctionErrorMessage == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 1)
        let correction = rows.first
        #expect(correction?.correctsObservationId == "obs-1")
        #expect(correction.flatMap(model.correctionOfText) == "Amendment of observation obs-1")
    }

    @Test("a row present in both the server response and local pending storage no longer shows the saved-locally badge")
    func pendingBadgeClearsOnceServerConfirms() async {
        let gateway = FakeObservationGateway()
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "Recorded offline"
        await model.submitRecordObservation()

        guard case let .loaded(beforeRows) = model.state, let recorded = beforeRows.first else {
            Issue.record("Expected the freshly recorded observation to be visible")
            return
        }
        #expect(recorded.isPendingSync == true)

        // Simulate a future push engine (P5-IOS-03, not yet built) having
        // confirmed this exact observation server-side — its id now also
        // appears in what the gateway returns.
        gateway.seedConfirmed(observation(id: recorded.id))

        await model.load()

        guard case let .loaded(afterRows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(afterRows.count == 1)
        #expect(afterRows.first?.isPendingSync == false)
    }

    // MARK: - Photo attachment (P6-IOS-01)

    @Test("a view model with no photo-attachment capability wired in never blocks submit and exposes an empty status")
    func noPhotoAttachmentWiredByDefault() {
        let gateway = FakeObservationGateway(observations: [])
        let model = makeModel(gateway: gateway)

        #expect(model.photoAttachment == nil)
        #expect(model.isPhotoBlockingSubmit == false)
        #expect(model.photoStatusText == "")
    }

    @Test("submitRecordObservation still succeeds with no photo attached")
    func submitSucceedsWithNoPhoto() async {
        let gateway = FakeObservationGateway(observations: [])
        let model = makeModel(gateway: gateway)
        model.recordNoteText = "Looking healthy"

        await model.submitRecordObservation()

        #expect(model.recordErrorMessage == nil)
    }

    // MARK: - Health-suggestion disposition (P11-HEALTH-01)

    @Test("saveDisposition(for:) saves a changed selection and reloads, showing the update")
    func saveDispositionSavesChangedSelection() async {
        let gateway = FakeObservationGateway(observations: [observationWithAnalysisResult()])
        let model = makeModel(gateway: gateway)
        await model.load()
        guard case let .loaded(rows) = model.state, let summary = rows.first?.analysisSummaries.first else {
            Issue.record("Expected a loaded row with one analysis summary")
            return
        }

        model.selectedDisposition[summary.id] = .acceptedAsObservation
        await model.saveDisposition(for: summary)

        #expect(model.dispositionErrorMessage[summary.id] == nil)
        #expect(model.dispositionSavedIds.contains(summary.id))
        guard case let .loaded(reloadedRows) = model.state,
            let reloadedSummary = reloadedRows.first?.analysisSummaries.first
        else {
            Issue.record("Expected a reloaded row with one analysis summary")
            return
        }
        #expect(reloadedSummary.disposition == .acceptedAsObservation)
        #expect(reloadedSummary.dispositionSetAtText != nil)
    }

    @Test("saveDisposition(for:) is a no-op when the selection did not change")
    func saveDispositionNoOpWhenUnchanged() async {
        let gateway = FakeObservationGateway(observations: [observationWithAnalysisResult(disposition: .rejected)])
        let model = makeModel(gateway: gateway)
        await model.load()
        guard case let .loaded(rows) = model.state, let summary = rows.first?.analysisSummaries.first else {
            Issue.record("Expected a loaded row with one analysis summary")
            return
        }

        await model.saveDisposition(for: summary)

        #expect(model.dispositionSavedIds.isEmpty)
    }

    @Test("saveDisposition(for:) surfaces a gateway failure keyed by the analysis result id")
    func saveDispositionSurfacesFailure() async {
        let gateway = FakeObservationGateway(observations: [observationWithAnalysisResult()])
        let model = makeModel(gateway: gateway)
        await model.load()
        guard case let .loaded(rows) = model.state, let summary = rows.first?.analysisSummaries.first else {
            Issue.record("Expected a loaded row with one analysis summary")
            return
        }

        gateway.nextDispositionFailure = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        model.selectedDisposition[summary.id] = .rejected
        await model.saveDisposition(for: summary)

        #expect(model.dispositionErrorMessage[summary.id] != nil)
        #expect(model.dispositionSavedIds.contains(summary.id) == false)
    }

    @Test("modelUnavailable renders when modelName is nil, matching NO_ANALYSIS_OUTCOME's placeholder shape")
    func modelUnavailableReflectsMissingModelName() async {
        let result = ImageAnalysisResult(
            id: "analysis-1", analysisKind: .other, suggestedLabel: "No automated analysis available yet.",
            confidenceScore: 0, requiresConfirmation: true, requestedAdditionalEvidence: true,
            evidenceSummary: "", alternativeExplanations: [], safetyClass: .informational,
            requestedViewPurposes: [], modelName: nil, promptVersion: nil, disposition: .unresolved,
            dispositionSetAt: nil, dispositionSetByProfileId: nil, createdAt: Date(timeIntervalSince1970: 0)
        )
        let photo = ObservationPhoto(
            id: "photo-1", mediaId: "media-1", purpose: .wholePlant,
            createdAt: Date(timeIntervalSince1970: 0), analysisResults: [result]
        )
        let observationWithUnavailableModel = GardenObservation(
            id: "obs-1", gardenId: "garden-1", plantId: "plant-1", gardenObjectId: nil, actorType: .user,
            createdByProfileId: "profile-1", noteText: nil, conditionSummary: nil,
            correctionKind: nil, correctsObservationId: nil, isCorrected: false,
            observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: [photo]
        )
        let gateway = FakeObservationGateway(observations: [observationWithUnavailableModel])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(rows) = model.state, let summary = rows.first?.analysisSummaries.first else {
            Issue.record("Expected a loaded row with one analysis summary")
            return
        }
        #expect(summary.modelUnavailable)
    }
}
