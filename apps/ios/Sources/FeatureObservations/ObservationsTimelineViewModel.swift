import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a garden's observation timeline: a chronological history,
/// optionally filtered to one plant, a "record observation" form, and a
/// correction ("amend"/"supersede") action per row.
///
/// Always fresh from the server, no local cache. `GardenObservation` rows are
/// immutable and append-only (no revision, no update path at all — see that
/// type's doc comment), so the concrete "stale revision causes a spurious
/// conflict" risk `MapEditorViewModel`/`PlantDetailViewModel` document does
/// not apply here the same way; a cache was still not built because nothing
/// in this pass's UX bar needs one — `MapEditorViewModel`'s own object list
/// already establishes that a brief loading spinner before a list of records
/// appears is an accepted pattern in this app — and one would have had to
/// duplicate this operation's split between a garden-wide and a per-plant
/// list for no proven benefit.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Observations`.
@MainActor
@Observable
public final class ObservationsTimelineViewModel {
    public private(set) var state: ObservationsTimelineViewState = .loading

    /// TODO(P4-IOS-01): see `PlantsHomeViewModel`'s doc comment on the same
    /// TODO — there is no plant list or picker to offer here either, for the
    /// same missing-endpoint and cross-feature-dependency reasons.
    public var plantIdFilter: String = ""

    // Record-observation form fields.
    public var recordNoteText: String = ""
    public var recordConditionSummary: String = ""
    public var recordPlantId: String = ""
    public var recordGardenObjectId: String = ""
    public var recordHasObservedAt: Bool = false
    public var recordObservedAt: Date = .now
    public private(set) var isSubmittingRecord = false
    public private(set) var recordErrorMessage: String?

    /// Non-`nil` while the correction sheet is open for that observation.
    public var correctingObservationId: String?
    public private(set) var isSubmittingCorrection = false
    public private(set) var correctionErrorMessage: String?

    public let gardenId: String
    private let recordObservation: RecordObservation
    private let listObservationsForGarden: ListObservationsForGarden
    private let listObservationsForPlant: ListObservationsForPlant
    private let correctObservation: CorrectObservation
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        recordObservation: RecordObservation,
        listObservationsForGarden: ListObservationsForGarden,
        listObservationsForPlant: ListObservationsForPlant,
        correctObservation: CorrectObservation,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.recordObservation = recordObservation
        self.listObservationsForGarden = listObservationsForGarden
        self.listObservationsForPlant = listObservationsForPlant
        self.correctObservation = correctObservation
        self.strings = strings
    }

    public var title: String { strings(.observationsTitle) }
    public var loadingMessage: String { strings(.observationsLoading) }
    public var retryTitle: String { strings(.observationsRetry) }
    public var emptyMessage: String { strings(.observationsEmpty) }
    public var filterLabel: String { strings(.observationsFilterLabel) }
    public var filterApplyTitle: String { strings(.observationsFilterApply) }
    public var filterClearTitle: String { strings(.observationsFilterClear) }
    public var recordSectionTitle: String { strings(.observationsRecordSectionTitle) }
    public var noteTextLabel: String { strings(.observationsNoteTextLabel) }
    public var conditionSummaryLabel: String { strings(.observationsConditionSummaryLabel) }
    public var plantIdLabel: String { strings(.observationsPlantIdLabel) }
    public var gardenObjectIdLabel: String { strings(.observationsGardenObjectIdLabel) }
    public var mapObjectIdHint: String { strings(.observationsMapObjectIdHint) }
    public var observedAtToggleLabel: String { strings(.observationsObservedAtToggle) }
    public var observedAtLabel: String { strings(.observationsObservedAtLabel) }
    public var recordSubmitTitle: String { strings(.observationsRecordSubmit) }
    public var correctedBadgeText: String { strings(.observationsCorrectedBadge) }
    public var correctActionTitle: String { strings(.observationsCorrectAction) }
    public var analysisDisclaimer: String { strings(.observationsAnalysisDisclaimer) }
    public var additionalEvidenceRequested: String { strings(.observationsAdditionalEvidenceRequested) }
    public var correctionSheetTitle: String { strings(.observationsCorrectionSheetTitle) }
    public var correctionKindLabel: String { strings(.observationsCorrectionKindLabel) }
    public var correctionSubmitTitle: String { strings(.observationsCorrectionSubmit) }
    public var closeTitle: String { strings(.observationsClose) }

    public func correctionKindName(_ kind: ObservationCorrectionKind) -> String {
        ObservationsLocalization.correctionKindName(kind, strings: strings)
    }

    /// The correction row's own label, naming the observation it corrects —
    /// `nil` when `row` is not itself a correction. Mirrors
    /// `apps/web/features/observations/observation-entry.tsx`'s
    /// `"{kind} of observation {id}"`.
    public func correctionOfText(for row: ObservationRow) -> String? {
        guard let correctionKindLabel = row.correctionKindLabel else { return nil }
        return strings.string(
            .observationsCorrectionOf,
            parameters: ["kind": correctionKindLabel, "id": row.correctsObservationId ?? ""]
        )
    }

    public func load() async {
        state = .loading

        let trimmedFilter = plantIdFilter.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let observations =
                if trimmedFilter.isEmpty {
                    try await listObservationsForGarden(gardenId: gardenId)
                } else {
                    try await listObservationsForPlant(gardenId: gardenId, plantId: trimmedFilter)
                }
            state = .loaded(observations.map(row))
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    public func clearFilter() async {
        plantIdFilter = ""
        await load()
    }

    public func submitRecordObservation() async {
        let note = recordNoteText.trimmingCharacters(in: .whitespacesAndNewlines)
        let condition = recordConditionSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty || !condition.isEmpty else {
            recordErrorMessage = strings(.observationsRecordRequiresContent)
            return
        }

        isSubmittingRecord = true
        recordErrorMessage = nil
        defer { isSubmittingRecord = false }

        do {
            _ = try await recordObservation(
                gardenId: gardenId,
                plantId: recordPlantId.isEmpty ? nil : recordPlantId,
                gardenObjectId: recordGardenObjectId.isEmpty ? nil : recordGardenObjectId,
                noteText: note.isEmpty ? nil : note,
                conditionSummary: condition.isEmpty ? nil : condition,
                observedAt: recordHasObservedAt ? recordObservedAt : nil
            )
            resetRecordForm()
            await load()
        } catch let error as APIGatewayError {
            recordErrorMessage = message(for: error)
        } catch {
            recordErrorMessage = strings(.serverUnexpected)
        }
    }

    /// Passed to the correction sheet as its submit action. Never edits the
    /// original row — it stays visible and unmodified; this appends a new
    /// row that points back to it.
    public func submitCorrection(kind: ObservationCorrectionKind, noteText: String?, conditionSummary: String?) async {
        guard let observationId = correctingObservationId else { return }

        isSubmittingCorrection = true
        correctionErrorMessage = nil
        defer { isSubmittingCorrection = false }

        do {
            _ = try await correctObservation(
                observationId: observationId,
                correctionKind: kind,
                noteText: noteText,
                conditionSummary: conditionSummary
            )
            correctingObservationId = nil
            await load()
        } catch let error as APIGatewayError {
            correctionErrorMessage = message(for: error)
        } catch {
            correctionErrorMessage = strings(.serverUnexpected)
        }
    }

    private func resetRecordForm() {
        recordNoteText = ""
        recordConditionSummary = ""
        recordPlantId = ""
        recordGardenObjectId = ""
        recordHasObservedAt = false
        recordObservedAt = .now
    }

    private func row(_ observation: GardenObservation) -> ObservationRow {
        ObservationRow(
            id: observation.id,
            noteText: observation.noteText,
            conditionSummary: observation.conditionSummary,
            observedAtText: ObservationsLocalization.formattedObservedAt(observation.observedAt),
            isCorrected: observation.isCorrected,
            correctionKindLabel: observation.correctionKind.map(correctionKindName),
            correctsObservationId: observation.correctsObservationId,
            analysisSummaries: observation.photos.flatMap(analysisSummaries)
        )
    }

    private func analysisSummaries(for photo: ObservationPhoto) -> [ObservationAnalysisSummary] {
        photo.analysisResults.map { result in
            ObservationAnalysisSummary(
                id: result.id,
                kindLabel: ObservationsLocalization.analysisKindName(result.analysisKind, strings: strings),
                suggestedLabel: result.suggestedLabel,
                confidenceText: Self.percentFormatter().string(from: NSNumber(value: result.confidenceScore)) ?? "",
                requiresConfirmation: result.requiresConfirmation,
                requestedAdditionalEvidence: result.requestedAdditionalEvidence
            )
        }
    }

    /// Not a stored `static let`: `NumberFormatter` is not `Sendable` — the
    /// same reason `LocalizedStrings.numberFormatter(for:)` computes one
    /// fresh rather than storing it.
    private static func percentFormatter() -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .percent
        formatter.maximumFractionDigits = 0
        return formatter
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
