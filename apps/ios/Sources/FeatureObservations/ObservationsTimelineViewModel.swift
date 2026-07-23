import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a garden's observation timeline: a chronological history,
/// optionally filtered to one plant, a "record observation" form, and a
/// correction ("amend"/"supersede") action per row.
///
/// Every server-confirmed row still comes from `listObservationsForGarden`/
/// `listObservationsForPlant` fresh on every `load()` — no local cache of
/// *those* was built, for the reasoning this doc comment already gave before
/// P5-IOS-02 (Stage 4d): `GardenObservation` rows are immutable and
/// append-only (no revision, no update path at all — see that type's own
/// doc comment), so the "stale revision causes a spurious conflict" risk
/// `MapEditorViewModel`/`PlantDetailViewModel` document never applied here,
/// and a brief loading spinner before a list of records appears is an
/// already-accepted pattern in this app (`MapEditorViewModel`'s own object
/// list).
///
/// `RecordObservation`/`CorrectObservation` themselves route through
/// `LocalObservationStore` as of Stage 4d (see `ObservationsUseCases.swift`'s
/// doc comment), so `load()` now also reads every observation this device
/// has appended purely offline (`ListObservationsForGarden.pending(gardenId:)`)
/// and MERGES it into whatever the network returns — not the cache-first-
/// then-overwrite shape `FeatureGardens.GardensListViewModel.load()`/
/// `FeaturePlants.PlantDetailViewModel.load()` use, and not a "protect a
/// pending row from being clobbered" guard either: neither applies to an
/// append-only feed, where a locally-appended row is never "the same row,
/// now stale" as anything the server could return — it is either present in
/// the server's response (already synced) or it is not (still pending), and
/// either way the correct action is to include it exactly once, not to
/// choose between two versions of the one row the way a mutable record's
/// cache-vs-server conflict would require. On top of the merge, `isCorrected`
/// is recomputed across the whole merged set — not read verbatim off
/// whichever source produced a row — so a pending local correction of a
/// server-confirmed observation still marks that observation "Corrected"
/// immediately, before the correction has any chance to sync.
///
/// Source: implementation-plan.md work package P4-IOS-01, P5-IOS-02;
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
    public var savedLocallyBadgeText: String { strings(.observationsSavedLocally) }
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

    /// Mirrors `FeatureGardens.GardensListViewModel.load()`'s cache-first
    /// shape — show what is immediately available before the network call
    /// that follows it resolves — with "cache" replaced by "this device's
    /// own locally-pending observations": see this type's own doc comment
    /// for why a merge, not a replace, is what this append-only feature
    /// needs on the network's success path, and why falling back to the
    /// pending set alone (rather than `.failed`) is only correct when there
    /// is a pending set to fall back to — an empty pending set on a
    /// transport failure still means "unknown," never "confirmed empty."
    public func load() async {
        let trimmedFilter = plantIdFilter.trimmingCharacters(in: .whitespacesAndNewlines)
        let pending = await pendingObservations(matchingFilter: trimmedFilter)
        let hadPendingResult = !pending.isEmpty

        if hadPendingResult {
            state = .loaded(mergedRows(server: [], pending: pending))
        } else {
            state = .loading
        }

        do {
            let observations =
                if trimmedFilter.isEmpty {
                    try await listObservationsForGarden(gardenId: gardenId)
                } else {
                    try await listObservationsForPlant(gardenId: gardenId, plantId: trimmedFilter)
                }
            state = .loaded(mergedRows(server: observations, pending: pending))
        } catch let error as APIGatewayError {
            if !hadPendingResult {
                state = .failed(message: message(for: error))
            }
        } catch {
            if !hadPendingResult {
                state = .failed(message: strings(.serverUnexpected))
            }
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
        } catch let error as ObservationCommandError {
            recordErrorMessage = message(for: error)
        } catch let error as APIGatewayError {
            recordErrorMessage = message(for: error)
        } catch {
            recordErrorMessage = strings(.serverUnexpected)
        }
    }

    /// Passed to the correction sheet as its submit action. Never edits the
    /// original row — it stays visible and unmodified; this appends a new
    /// row that points back to it.
    ///
    /// The corrected row's `plantId`/`gardenObjectId` come from `target`,
    /// the `ObservationRow` already on screen — not from a fresh local-store
    /// lookup by id — because `CorrectObservation` itself has nowhere else
    /// to read them from (see that type's own doc comment). `target` not
    /// being found (the corrected row scrolled out of a since-changed
    /// `state`) is treated the same as `correctingObservationId` itself
    /// being `nil` — a silent no-op, matching this method's own pre-existing
    /// guard for that case, not a new user-facing error path for a state
    /// this screen's own construction (a correction sheet is only ever
    /// opened for a row that is on screen) makes unreachable in practice.
    public func submitCorrection(kind: ObservationCorrectionKind, noteText: String?, conditionSummary: String?) async {
        guard
            let observationId = correctingObservationId,
            case let .loaded(rows) = state,
            let target = rows.first(where: { $0.id == observationId })
        else { return }

        isSubmittingCorrection = true
        correctionErrorMessage = nil
        defer { isSubmittingCorrection = false }

        do {
            _ = try await correctObservation(
                gardenId: gardenId,
                correctedObservationId: observationId,
                correctedPlantId: target.plantId,
                correctedGardenObjectId: target.gardenObjectId,
                correctionKind: kind,
                noteText: noteText,
                conditionSummary: conditionSummary
            )
            correctingObservationId = nil
            await load()
        } catch let error as ObservationCommandError {
            correctionErrorMessage = message(for: error)
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

    /// Every locally-pending observation for this timeline's `gardenId`,
    /// already narrowed to `trimmedFilter` when one is set — the plant
    /// filter is applied here, in memory, rather than by a second,
    /// plant-scoped store method: see `ListObservationsForGarden.pending
    /// (gardenId:)`'s own doc comment for why. `try?`: a local-read failure
    /// degrades to "nothing pending," the same posture `GardensListViewModel
    /// .load()`'s own `try? await listGardens.cached()` already takes,
    /// rather than blocking the whole screen on a local-storage error a
    /// network retry cannot fix anyway.
    private func pendingObservations(matchingFilter trimmedFilter: String) async -> [GardenObservation] {
        let pending = (try? await listObservationsForGarden.pending(gardenId: gardenId)) ?? []
        guard !trimmedFilter.isEmpty else { return pending }
        return pending.filter { $0.plantId == trimmedFilter }
    }

    /// Combines a network result with this device's own locally-pending
    /// observations into one chronological (`observedAt` descending,
    /// matching `kysely-observation-repository.ts`'s own `orderBy
    /// ('observed_at', 'desc')`) row list, recomputing `isCorrected` across
    /// the combined set rather than trusting either source's own value in
    /// isolation — see this type's own doc comment for why.
    ///
    /// `server` wins any id collision (dropped from `pending` instead) —
    /// not expected to ever actually happen this stage (no push engine
    /// exists yet to make a locally-appended row show up in a server
    /// response too), but a safe, cheap default for if one someday does:
    /// the server's copy is the more complete one.
    private func mergedRows(server: [GardenObservation], pending: [GardenObservation]) -> [ObservationRow] {
        let serverIds = Set(server.map(\.id))
        let stillPending = pending.filter { !serverIds.contains($0.id) }
        let pendingIds = Set(stillPending.map(\.id))
        let combined = server + stillPending
        let correctedIds = Set(combined.compactMap(\.correctsObservationId))

        return combined
            .sorted { lhs, rhs in
                lhs.observedAt != rhs.observedAt ? lhs.observedAt > rhs.observedAt : lhs.recordedAt > rhs.recordedAt
            }
            .map { observation in
                row(
                    observation,
                    isCorrected: observation.isCorrected || correctedIds.contains(observation.id),
                    isPendingSync: pendingIds.contains(observation.id)
                )
            }
    }

    private func row(_ observation: GardenObservation, isCorrected: Bool, isPendingSync: Bool) -> ObservationRow {
        ObservationRow(
            id: observation.id,
            plantId: observation.plantId,
            gardenObjectId: observation.gardenObjectId,
            noteText: observation.noteText,
            conditionSummary: observation.conditionSummary,
            observedAtText: ObservationsLocalization.formattedObservedAt(observation.observedAt),
            isCorrected: isCorrected,
            isPendingSync: isPendingSync,
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

    private func message(for failure: ObservationCommandError) -> String {
        switch failure {
        case .invalidContent:
            strings(.observationsRecordRequiresContent)
        case .payloadEncodingFailed:
            strings(.serverUnexpected)
        }
    }
}
