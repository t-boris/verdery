import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a single plant's detail screen: view, edit, lifecycle
/// stage, status (including delete, which is a status transition — there is
/// no hard-delete endpoint), and move.
///
/// Always fresh from the server, no local cache — see `Package.swift`'s doc
/// comment on the `FeaturePlants` target for why, the same reasoning
/// `MapEditorViewModel` documents for the map editor.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Plants`.
@MainActor
@Observable
public final class PlantDetailViewModel {
    public private(set) var state: PlantDetailViewState = .loading
    public private(set) var isSubmitting = false
    public private(set) var actionErrorMessage: String?

    // Edit-details form fields, populated from the loaded plant on `load()`.
    public var editedDisplayName: String = ""
    public var editedVarietyLabel: String = ""
    public var editedConditionNote: String = ""
    public var editedCareGuidanceNote: String = ""
    public var editedQuantityText: String = ""
    public var editedHasAcquisitionDate: Bool = false
    public var editedAcquisitionDate: Date = .now
    public var editedAcquisitionDateType: PlantAcquisitionDateType = .planted

    /// Non-`nil` means "this plant has an accepted identification"; `nil`
    /// means "not identified" — the same reading `PlantsHomeViewModel`'s
    /// `selectedTaxonomyReference` gives the add-plant form. This field
    /// holds only the id (what the wire format and `saveDetails()` need);
    /// `selectedTaxonomyReferenceDisplay` below holds the friendly name,
    /// when one is known.
    public private(set) var editedTaxonomyReferenceId: String?
    /// The full `TaxonomyReference` behind `editedTaxonomyReferenceId`, only
    /// when it is known — set the moment the user picks a match from
    /// `TaxonomyReferencePickerView`. There is no `GET` for a single
    /// taxonomy reference by id (only `SearchTaxonomyReferences`, a
    /// free-text search), so a plant's *existing* identification, loaded
    /// from the server as a bare id, cannot be resolved to a friendly name
    /// without the user re-searching for it — `selectedTaxonomySummary`
    /// falls back to showing the id itself in that case, honestly rather
    /// than fabricating a lookup this contract does not support.
    public private(set) var selectedTaxonomyReferenceDisplay: TaxonomyReference?
    public var isTaxonomyPickerPresented: Bool = false

    // Move form fields. Empty means "leave this placement field unchanged" —
    // `MovePlantRequest`'s two fields are not nullable on the wire, so there
    // is no way to explicitly clear a placement through this operation, only
    // to set a new one.
    /// TODO(P4-IOS-01): see `PlantsHomeViewModel`'s doc comment on the same
    /// TODO — a real map-object picker is out of scope this pass for the
    /// same cross-feature-dependency reason.
    public var editedGardenAreaMapObjectId: String = ""
    public var editedPlacementMapObjectId: String = ""

    public let gardenId: String
    public let plantId: String

    private let getPlant: GetPlant
    private let updatePlantDetails: UpdatePlantDetails
    private let transitionPlantLifecycleStage: TransitionPlantLifecycleStage
    private let setPlantStatus: SetPlantStatus
    private let movePlant: MovePlant
    private let searchTaxonomyReferences: SearchTaxonomyReferences
    private let strings: LocalizedStrings

    private var currentPlant: Plant?

    public init(
        gardenId: String,
        plantId: String,
        getPlant: GetPlant,
        updatePlantDetails: UpdatePlantDetails,
        transitionPlantLifecycleStage: TransitionPlantLifecycleStage,
        setPlantStatus: SetPlantStatus,
        movePlant: MovePlant,
        searchTaxonomyReferences: SearchTaxonomyReferences,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.plantId = plantId
        self.getPlant = getPlant
        self.updatePlantDetails = updatePlantDetails
        self.transitionPlantLifecycleStage = transitionPlantLifecycleStage
        self.setPlantStatus = setPlantStatus
        self.movePlant = movePlant
        self.searchTaxonomyReferences = searchTaxonomyReferences
        self.strings = strings
    }

    public var title: String { strings(.plantsDetailTitle) }
    public var loadingMessage: String { strings(.plantsDetailLoading) }
    public var retryTitle: String { strings(.plantsDetailRetry) }
    public var editSectionTitle: String { strings(.plantsDetailEditSectionTitle) }
    public var lifecycleStageLabel: String { strings(.plantsDetailLifecycleStageLabel) }
    public var statusLabel: String { strings(.plantsDetailStatusLabel) }
    public var saveTitle: String { strings(.plantsDetailSave) }
    public var moveSectionTitle: String { strings(.plantsDetailMoveSectionTitle) }
    public var moveSubmitTitle: String { strings(.plantsDetailMoveSubmit) }
    public var deleteActionTitle: String { strings(.plantsDetailDeleteAction) }
    public var displayNameLabel: String { strings(.plantsDisplayNameLabel) }
    public var varietyLabelLabel: String { strings(.plantsVarietyLabelLabel) }
    public var conditionNoteLabel: String { strings(.plantsDetailConditionNoteLabel) }
    public var careGuidanceNoteLabel: String { strings(.plantsDetailCareGuidanceNoteLabel) }
    public var quantityLabel: String { strings(.plantsQuantityLabel) }
    public var acquisitionDateToggleLabel: String { strings(.plantsAcquisitionDateToggle) }
    public var acquisitionDateLabel: String { strings(.plantsAcquisitionDateLabel) }
    public var acquisitionDateTypeLabel: String { strings(.plantsAcquisitionDateTypeLabel) }
    public var gardenAreaLabel: String { strings(.plantsGardenAreaLabel) }
    public var placementLabel: String { strings(.plantsPlacementLabel) }
    public var mapObjectIdHint: String { strings(.plantsMapObjectIdHint) }
    public var taxonomyLabel: String { strings(.plantsTaxonomyLabel) }
    public var taxonomyNoneLabel: String { strings(.plantsTaxonomyNone) }
    public var taxonomyClearLabel: String { strings(.plantsTaxonomyClear) }
    public var taxonomyPickerTitle: String { strings(.plantsTaxonomyPickerTitle) }
    public var taxonomyPickerSearchLabel: String { strings(.plantsTaxonomyPickerSearchLabel) }
    public var taxonomyPickerEmptyMessage: String { strings(.plantsTaxonomyPickerEmpty) }
    public var closeTitle: String { strings(.plantsClose) }

    public func lifecycleStageName(_ stage: PlantLifecycleStage) -> String {
        PlantsLocalization.lifecycleStageName(stage, strings: strings)
    }

    public func statusName(_ status: PlantStatus) -> String {
        PlantsLocalization.statusName(status, strings: strings)
    }

    public func acquisitionDateTypeName(_ type: PlantAcquisitionDateType) -> String {
        PlantsLocalization.acquisitionDateTypeName(type, strings: strings)
    }

    public func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        PlantsLocalization.taxonomyDisplayName(reference)
    }

    /// The friendly name when known (the user picked it this session), the
    /// raw id when an identification exists but its name has not been
    /// resolved (an existing plant, freshly loaded — see
    /// `selectedTaxonomyReferenceDisplay`'s doc comment), or
    /// `taxonomyNoneLabel` when the plant is not identified at all.
    public var selectedTaxonomySummary: String {
        guard let editedTaxonomyReferenceId else { return taxonomyNoneLabel }
        if let selectedTaxonomyReferenceDisplay {
            return taxonomyDisplayName(selectedTaxonomyReferenceDisplay)
        }
        return strings.string(.plantsTaxonomyIdentifiedId, parameters: ["id": editedTaxonomyReferenceId])
    }

    public func selectTaxonomy(_ reference: TaxonomyReference) {
        editedTaxonomyReferenceId = reference.id
        selectedTaxonomyReferenceDisplay = reference
        isTaxonomyPickerPresented = false
    }

    public func clearTaxonomy() {
        editedTaxonomyReferenceId = nil
        selectedTaxonomyReferenceDisplay = nil
    }

    /// Passed to `TaxonomyReferencePickerView` as its `search` closure. Never
    /// throws to the sheet — a search failure just shows no results, since
    /// leaving the plant's identification unchanged is always a valid
    /// outcome of this form. Mirrors `PlantsHomeViewModel.searchTaxonomy`.
    public func searchTaxonomy(query: String) async -> [TaxonomyReference] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return (try? await searchTaxonomyReferences(gardenId: gardenId, query: trimmed.isEmpty ? nil : trimmed)) ?? []
    }

    public func load() async {
        state = .loading
        actionErrorMessage = nil

        do {
            apply(try await getPlant(gardenId: gardenId, plantId: plantId))
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    private func apply(_ plant: Plant) {
        currentPlant = plant
        editedDisplayName = plant.displayName
        editedVarietyLabel = plant.varietyLabel ?? ""
        editedConditionNote = plant.conditionNote ?? ""
        editedCareGuidanceNote = plant.careGuidanceNote ?? ""
        editedQuantityText = plant.quantity.map(String.init) ?? ""
        editedHasAcquisitionDate = plant.acquisitionDate != nil
        editedAcquisitionDate = plant.acquisitionDate.flatMap(CalendarDate.date(from:)) ?? .now
        editedAcquisitionDateType = plant.acquisitionDateType ?? .planted
        editedGardenAreaMapObjectId = ""
        editedPlacementMapObjectId = ""
        editedTaxonomyReferenceId = plant.taxonomyReferenceId
        // Reset rather than carry forward: a friendly name resolved for a
        // previous load's identification does not necessarily still belong
        // to this one (a save may have changed it, another client may have
        // changed it, or this may be a different plant's `apply` call).
        selectedTaxonomyReferenceDisplay = nil

        state = .loaded(
            PlantDetailSummary(
                displayName: plant.displayName,
                groupingKindLabel: PlantsLocalization.groupingKindName(plant.groupingKind, strings: strings),
                groupingKind: plant.groupingKind,
                quantity: plant.quantity,
                lifecycleStage: plant.lifecycleStage,
                lifecycleStageLabel: lifecycleStageName(plant.lifecycleStage),
                status: plant.status,
                statusLabel: statusName(plant.status),
                taxonomyReferenceId: plant.taxonomyReferenceId,
                revision: plant.revision
            )
        )
    }

    public func saveDetails() async {
        guard let plant = currentPlant else { return }

        let trimmedName = editedDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            actionErrorMessage = strings(.plantsDisplayNameRequired)
            return
        }

        // `quantity` is only offered — and only sent — for a row or a group;
        // an `.individual` plant's server-side domain model rejects it
        // outright (`quantity.not_allowed`), the same restriction
        // `PlantsHomeViewModel.submitAddPlant` already respects on creation.
        // Mirrors `apps/web/features/plants/plant-details-form.tsx`'s own
        // `plant.groupingKind === 'individual' ? {} : { quantity: ... }`.
        let quantityUpdate: FieldUpdate<Int> =
            plant.groupingKind == .individual
                ? .unchanged
                : .set(editedQuantityText.isEmpty ? nil : Int(editedQuantityText))

        await perform { [self] in
            try await updatePlantDetails(
                gardenId: gardenId,
                plantId: plantId,
                displayName: trimmedName,
                taxonomyReferenceId: .set(editedTaxonomyReferenceId),
                varietyLabel: .set(editedVarietyLabel.isEmpty ? nil : editedVarietyLabel),
                acquisitionDate: .set(editedHasAcquisitionDate ? CalendarDate.string(from: editedAcquisitionDate) : nil),
                acquisitionDateType: .set(editedHasAcquisitionDate ? editedAcquisitionDateType : nil),
                conditionNote: .set(editedConditionNote.isEmpty ? nil : editedConditionNote),
                careGuidanceNote: .set(editedCareGuidanceNote.isEmpty ? nil : editedCareGuidanceNote),
                quantity: quantityUpdate,
                expectedRevision: plant.revision
            )
        }
    }

    public func transitionLifecycleStage(to stage: PlantLifecycleStage) async {
        guard let plant = currentPlant else { return }

        await perform { [self] in
            try await transitionPlantLifecycleStage(
                gardenId: gardenId,
                plantId: plantId,
                stage: stage,
                expectedRevision: plant.revision
            )
        }
    }

    public func setStatus(_ status: PlantStatus) async {
        guard let plant = currentPlant else { return }

        await perform { [self] in
            try await setPlantStatus(gardenId: gardenId, plantId: plantId, status: status, expectedRevision: plant.revision)
        }
    }

    /// The detail screen's "Delete" affordance: `SetPlantStatus(.removed)`,
    /// not a hard delete — there is no `DELETE` endpoint for a plant.
    public func delete() async {
        await setStatus(.removed)
    }

    public func submitMove() async {
        guard let plant = currentPlant else { return }

        await perform { [self] in
            try await movePlant(
                gardenId: gardenId,
                plantId: plantId,
                gardenAreaMapObjectId: editedGardenAreaMapObjectId.isEmpty ? nil : editedGardenAreaMapObjectId,
                placementMapObjectId: editedPlacementMapObjectId.isEmpty ? nil : editedPlacementMapObjectId,
                expectedRevision: plant.revision
            )
        }
    }

    private func perform(_ action: () async throws -> Plant) async {
        isSubmitting = true
        actionErrorMessage = nil
        defer { isSubmitting = false }

        do {
            apply(try await action())
        } catch let error as APIGatewayError {
            actionErrorMessage = message(for: error)
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
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
