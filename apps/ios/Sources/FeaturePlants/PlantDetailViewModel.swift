import CoreDomain
import CoreLocalization
import CoreMediaTransfer
import CoreNetworking
import Foundation
import Observation

/// View model for a single plant's detail screen: view, edit, lifecycle
/// stage, status (including delete, which is a status transition — there is
/// no hard-delete endpoint), and move.
///
/// The four mutating commands here (`saveDetails`, `transitionLifecycleStage`,
/// `setStatus`, `submitMove`) route through the local-projection-plus-outbox
/// pattern as of P5-IOS-02 (Stage 4c) — see `PlantsUseCases.swift`'s doc
/// comment. `load()` itself stays what `Package.swift`'s doc comment on the
/// `FeaturePlants` target still calls "always fresh from server": `getPlant`
/// is still an online, gateway-backed call for a plant this device already
/// knows the server's copy of, the same reasoning `MapEditorViewModel`
/// documents for the map editor's own always-fresh reads. What changed is
/// only that `load()` now tries `getPlant.cached(plantId:)` first, the same
/// cache-first-then-network-refresh shape `GardenSettingsViewModel.load()`
/// already uses — necessary here specifically because
/// `PlantsHomeViewModel.performAdd()` navigates straight to this screen for
/// a plant `AddPlant` may have just created purely locally, which
/// `getPlant`'s network call alone could never fetch.
///
/// Source: implementation-plan.md work package P4-IOS-01, P5-IOS-02;
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

    /// The "Attach Photo" affordance's own upload progress/status —
    /// `nil` only for a `PlantDetailViewModel` built with no media-upload
    /// capability wired in (every existing test double, and every
    /// `PlantDetailViewModel` this codebase constructs anywhere else keeps
    /// working unchanged; `AppCompositionRoot.makePlantDetailViewModel`
    /// supplies a real one). `PlantDetailView` reads this directly — it is
    /// itself `@Observable`, so a nested read is tracked the same way a
    /// top-level property read is.
    public let photoAttachment: PhotoAttachmentController?
    private let attachPlantPhoto: AttachPlantPhoto?
    /// Set once `attachPlantPhoto` succeeds this screen session — an
    /// ephemeral confirmation, not a durable "this plant's photos" list:
    /// `Plant` (this client's own domain type) carries no `photos` field at
    /// all, and no `GET` endpoint to list a plant's attached photos is
    /// modeled anywhere in this codebase yet (a real, separate gap, not a
    /// hidden one — see this stage's own report).
    public private(set) var photoAttachedConfirmation: Bool = false
    public private(set) var photoAttachErrorMessage: String?

    private let getPlant: GetPlant
    private let updatePlantDetails: UpdatePlantDetails
    private let transitionPlantLifecycleStage: TransitionPlantLifecycleStage
    private let setPlantStatus: SetPlantStatus
    private let movePlant: MovePlant
    private let searchTaxonomyReferences: SearchTaxonomyReferences
    private let strings: LocalizedStrings
    private let fetchPlantIdentification: FetchPlantIdentification?
    private let confirmPlantIdentification: ConfirmPlantIdentification?

    /// A still-pending `AddPlantFromPhoto` suggestion for this plant (ADR-0015),
    /// when one exists — `nil` both when there is none and when
    /// `fetchPlantIdentification` was not wired in (every existing test double
    /// and call site keeps working unchanged, the same optional-capability
    /// shape `photoAttachment` already establishes). Populated best-effort by
    /// `load()`: a failure fetching it never fails the plant load itself,
    /// mirroring how leaving a plant unidentified is always a valid outcome
    /// elsewhere in this feature.
    public private(set) var pendingIdentification: PlantIdentification?

    private var currentPlant: Plant?
    /// Set once an edit/lifecycle-stage/status/move commits locally this
    /// session — mirrors `GardenSettingsViewModel.isSavedLocally`'s identical
    /// role and its identical two jobs: driving `PlantDetailSummary
    /// .syncStatusLabel`, and guarding `load()` from re-applying a fresh
    /// `getPlant` network response, which — while this is `true` — is
    /// necessarily stale (it reflects the server's state from before this
    /// session's still-unpushed local mutation).
    private var isSavedLocally = false

    public init(
        gardenId: String,
        plantId: String,
        getPlant: GetPlant,
        updatePlantDetails: UpdatePlantDetails,
        transitionPlantLifecycleStage: TransitionPlantLifecycleStage,
        setPlantStatus: SetPlantStatus,
        movePlant: MovePlant,
        searchTaxonomyReferences: SearchTaxonomyReferences,
        strings: LocalizedStrings,
        photoAttachment: PhotoAttachmentController? = nil,
        attachPlantPhoto: AttachPlantPhoto? = nil,
        fetchPlantIdentification: FetchPlantIdentification? = nil,
        confirmPlantIdentification: ConfirmPlantIdentification? = nil
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
        self.photoAttachment = photoAttachment
        self.attachPlantPhoto = attachPlantPhoto
        self.fetchPlantIdentification = fetchPlantIdentification
        self.confirmPlantIdentification = confirmPlantIdentification
    }

    public var photoSectionTitle: String { strings(.mediaAttachSectionTitle) }
    public var photoPickButtonTitle: String { strings(.mediaAttachPickButton) }
    public var photoRetryButtonTitle: String { strings(.mediaAttachRetryButton) }
    public var photoRemoveButtonTitle: String { strings(.mediaAttachRemoveButton) }
    public var takePhotoButtonTitle: String { strings(.mediaCaptureTakePhotoButton) }
    public var cameraPermissionDeniedMessage: String { strings(.mediaCapturePermissionDeniedMessage) }
    public var openSettingsButtonTitle: String { strings(.mediaCaptureOpenSettingsButton) }

    /// Localized text for the current photo-attachment status — a thin
    /// wrapper over `CoreMediaTransfer.PhotoAttachmentStatusLocalization` so
    /// `PlantDetailView` never needs its own `LocalizedStrings` instance
    /// (view models are this codebase's only holder of one, matching every
    /// other screen).
    public var photoStatusText: String {
        PhotoAttachmentStatusLocalization.text(for: photoAttachment?.status ?? .idle, strings: strings)
    }

    public var identificationPendingBanner: String { strings(.plantsIdentificationPendingBanner) }
    public var identificationSuggestedLabel: String { strings(.plantsIdentificationSuggestedLabel) }
    public var identificationConfidenceLabel: String { strings(.plantsIdentificationConfidenceLabel) }
    public var identificationConfirmButtonTitle: String { strings(.plantsIdentificationConfirmButton) }
    public var identificationUnlistedNote: String { strings(.plantsIdentificationUnlistedNote) }

    public func identificationSuggestionDisplayName(_ suggestion: PlantIdentificationSuggestion) -> String {
        suggestion.commonName?.isEmpty == false ? suggestion.commonName! : suggestion.scientificName
    }

    /// The AI's own raw name guess, when it was confident but the catalog
    /// had no match for it — see `PlantAddFromPhotoViewModel
    /// .rawSuggestionDisplayName(commonName:scientificName:)`'s identical
    /// doc comment.
    public func rawIdentificationSuggestionDisplayName(
        commonName: String,
        scientificName: String?
    ) -> String {
        commonName.isEmpty == false ? commonName : (scientificName ?? "")
    }

    public func identificationConfidenceText(_ confidenceScore: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .percent
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: confidenceScore)) ?? ""
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
        actionErrorMessage = nil
        var hadCachedResult = false

        // Mirrors `GardenSettingsViewModel.load()`: try the immediately-
        // available local row first — the only way a plant `AddPlant`
        // created purely offline this session can be shown at all, since
        // `getPlant`'s network fetch below has nothing to find for it yet.
        if let cached = try? await getPlant.cached(plantId: plantId) {
            apply(cached)
            hadCachedResult = true
        } else {
            state = .loading
        }

        do {
            let fetched = try await getPlant(gardenId: gardenId, plantId: plantId)
            if !isSavedLocally {
                apply(fetched)
            }
        } catch let error as APIGatewayError {
            if !hadCachedResult {
                state = .failed(message: message(for: error))
            }
        } catch {
            if !hadCachedResult {
                state = .failed(message: strings(.serverUnexpected))
            }
        }

        if let fetchPlantIdentification {
            pendingIdentification = try? await fetchPlantIdentification(gardenId: gardenId, plantId: plantId)
        }
    }

    /// Accepts the banner's suggestion — a no-op without both a fetched
    /// suggestion and a loaded plant to confirm it against. Reuses `perform`,
    /// the same submit/apply/error-handling shape every other mutating
    /// action here already uses.
    public func confirmPendingIdentification() async {
        guard let confirmPlantIdentification, let identification = pendingIdentification, let plant = currentPlant else {
            return
        }

        await perform {
            try await confirmPlantIdentification(
                gardenId: gardenId,
                plantId: plantId,
                identificationId: identification.id,
                expectedRevision: plant.revision
            )
        }
        if actionErrorMessage == nil {
            pendingIdentification = nil
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
                revision: plant.revision,
                syncStatusLabel: isSavedLocally ? strings(.plantsSavedLocally) : nil
            )
        )
    }

    public func saveDetails() async {
        guard let plant = currentPlant else { return }

        let resolvedDetails: (displayName: String, quantity: Int?)
        switch AddPlantFormValidation.resolve(
            displayName: editedDisplayName,
            groupingKind: plant.groupingKind,
            quantityText: editedQuantityText
        ) {
        case let .failure(failure):
            actionErrorMessage = message(for: failure)
            return
        case let .success(details):
            resolvedDetails = details
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
                : .set(resolvedDetails.quantity)

        await perform { [self] in
            try await updatePlantDetails(
                gardenId: gardenId,
                plantId: plantId,
                displayName: resolvedDetails.displayName,
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

    /// Starts a brand-new photo attachment: durably persists `data` and
    /// kicks off background registration/upload — see
    /// `CoreMediaTransfer.MediaUploadCoordinator.enqueue`'s own doc comment
    /// for the local-durability guarantee this inherits. `attachPickedPhoto`
    /// below is the caller's own responsibility to invoke once
    /// `photoAttachment.mediaId` becomes non-`nil` — `PlantDetailView`
    /// itself does that via `.onChange(of:)`, keeping the "when is the
    /// upload actually done" observation in the view (which already reads
    /// `photoAttachment.status` for progress) rather than duplicated here.
    public func pickPhoto(data: Data, contentType: String) async {
        guard let photoAttachment else { return }
        photoAttachedConfirmation = false
        photoAttachErrorMessage = nil
        await photoAttachment.attach(data: data, displayFilename: "plant-\(plantId)-photo", contentType: contentType)
    }

    /// The last step of the pick → upload → verify → attach sequence:
    /// `AttachPlantPhoto` against the server-confirmed `mediaId`
    /// `photoAttachment.status` resolved to `.ready`.
    public func attachPickedPhoto(mediaId: String) async {
        guard let attachPlantPhoto else { return }

        do {
            _ = try await attachPlantPhoto(gardenId: gardenId, plantId: plantId, mediaId: mediaId)
            photoAttachedConfirmation = true
            photoAttachErrorMessage = nil
        } catch let error as APIGatewayError {
            photoAttachErrorMessage = message(for: error)
        } catch {
            photoAttachErrorMessage = strings(.serverUnexpected)
        }
    }

    public func retryPhotoUpload() async {
        await photoAttachment?.retry()
    }

    public func discardPickedPhoto() async {
        photoAttachedConfirmation = false
        photoAttachErrorMessage = nil
        await photoAttachment?.discard()
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

    /// Shared by every offline-capable mutator (`saveDetails`,
    /// `transitionLifecycleStage`, `setStatus`, `submitMove`): sets
    /// `isSavedLocally` once, right here, rather than repeating it at each of
    /// the four call sites — all four commit through the same local-only
    /// transaction, so a success here always means the same thing.
    private func perform(_ action: () async throws -> Plant) async {
        isSubmitting = true
        actionErrorMessage = nil
        defer { isSubmitting = false }

        do {
            let plant = try await action()
            isSavedLocally = true
            apply(plant)
        } catch let error as PlantCommandError {
            actionErrorMessage = message(for: error)
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

    private func message(for failure: AddPlantFormValidation.Failure) -> String {
        switch failure {
        case .displayNameRequired: strings(.plantsDisplayNameRequired)
        case .quantityRequired: strings(.plantsQuantityRequired)
        case .quantityMustBePositive: strings(.plantsQuantityMustBePositive)
        }
    }

    private func message(for failure: PlantCommandError) -> String {
        switch failure {
        case .invalidDisplayName:
            strings(.plantsDisplayNameRequired)
        case .localRecordNotFound, .payloadEncodingFailed, .conflictResolutionPayloadMalformed:
            strings(.serverUnexpected)
        }
    }
}
