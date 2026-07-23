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
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.plantId = plantId
        self.getPlant = getPlant
        self.updatePlantDetails = updatePlantDetails
        self.transitionPlantLifecycleStage = transitionPlantLifecycleStage
        self.setPlantStatus = setPlantStatus
        self.movePlant = movePlant
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

    public func lifecycleStageName(_ stage: PlantLifecycleStage) -> String {
        PlantsLocalization.lifecycleStageName(stage, strings: strings)
    }

    public func statusName(_ status: PlantStatus) -> String {
        PlantsLocalization.statusName(status, strings: strings)
    }

    public func acquisitionDateTypeName(_ type: PlantAcquisitionDateType) -> String {
        PlantsLocalization.acquisitionDateTypeName(type, strings: strings)
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

        state = .loaded(
            PlantDetailSummary(
                displayName: plant.displayName,
                groupingKindLabel: PlantsLocalization.groupingKindName(plant.groupingKind, strings: strings),
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

        await perform { [self] in
            try await updatePlantDetails(
                gardenId: gardenId,
                plantId: plantId,
                displayName: trimmedName,
                varietyLabel: .set(editedVarietyLabel.isEmpty ? nil : editedVarietyLabel),
                acquisitionDate: .set(editedHasAcquisitionDate ? CalendarDate.string(from: editedAcquisitionDate) : nil),
                acquisitionDateType: .set(editedHasAcquisitionDate ? editedAcquisitionDateType : nil),
                conditionNote: .set(editedConditionNote.isEmpty ? nil : editedConditionNote),
                careGuidanceNote: .set(editedCareGuidanceNote.isEmpty ? nil : editedCareGuidanceNote),
                quantity: .set(editedQuantityText.isEmpty ? nil : Int(editedQuantityText)),
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
