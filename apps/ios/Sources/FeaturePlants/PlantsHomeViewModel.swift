import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for the plant inventory's entry point: an "Add a plant" form,
/// and an "Open a plant" field for a plant id already known — see
/// `PlantsHomeView`'s doc comment for why the latter exists at all.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Plants`.
@MainActor
@Observable
public final class PlantsHomeViewModel {
    public private(set) var state: PlantsHomeViewState = .idle

    // Add-plant form fields.
    public var displayName: String = ""
    public var groupingKind: PlantGroupingKind = .individual
    public var quantityText: String = ""
    public var varietyLabel: String = ""
    public var hasAcquisitionDate: Bool = false
    public var acquisitionDate: Date = .now
    public var acquisitionDateType: PlantAcquisitionDateType = .planted
    public private(set) var selectedTaxonomyReference: TaxonomyReference?
    public var gardenAreaMapObjectId: String = ""
    public var placementMapObjectId: String = ""
    public var isTaxonomyPickerPresented: Bool = false

    // Map-object picker (garden area / placement) — see
    // `MapObjectPickerView`'s own doc comment for why this reimplements
    // `FeatureMap.MapGateFencePickerView`'s shape rather than importing it.
    public private(set) var mapObjects: [GardenMapObject] = []
    public var activeMapObjectField: MapObjectPlacementField?

    // "Open a plant" field.
    public var openPlantId: String = ""

    public private(set) var navigateToPlantId: String?

    private let addPlant: AddPlant
    private let searchTaxonomyReferences: SearchTaxonomyReferences
    /// `nil` only for a `PlantsHomeViewModel` built with no map-object
    /// picker capability wired in — the same optional-capability shape
    /// `PlantDetailViewModel.photoAttachment` already establishes, so every
    /// existing test double keeps working unchanged;
    /// `AppCompositionRoot.makePlantsHomeViewModel` supplies a real one.
    private let listGardenMapObjects: ListGardenMapObjects?
    private let strings: LocalizedStrings
    let gardenId: String

    public init(
        gardenId: String,
        addPlant: AddPlant,
        searchTaxonomyReferences: SearchTaxonomyReferences,
        strings: LocalizedStrings,
        listGardenMapObjects: ListGardenMapObjects? = nil
    ) {
        self.gardenId = gardenId
        self.addPlant = addPlant
        self.searchTaxonomyReferences = searchTaxonomyReferences
        self.listGardenMapObjects = listGardenMapObjects
        self.strings = strings
    }

    public var title: String { strings(.plantsTitle) }
    public var addSectionTitle: String { strings(.plantsAddSectionTitle) }
    public var displayNameLabel: String { strings(.plantsDisplayNameLabel) }
    public var groupingKindLabel: String { strings(.plantsGroupingKindLabel) }
    public var quantityLabel: String { strings(.plantsQuantityLabel) }
    public var varietyLabelLabel: String { strings(.plantsVarietyLabelLabel) }
    public var acquisitionDateToggleLabel: String { strings(.plantsAcquisitionDateToggle) }
    public var acquisitionDateLabel: String { strings(.plantsAcquisitionDateLabel) }
    public var acquisitionDateTypeLabel: String { strings(.plantsAcquisitionDateTypeLabel) }
    public var taxonomyLabel: String { strings(.plantsTaxonomyLabel) }
    public var taxonomyNoneLabel: String { strings(.plantsTaxonomyNone) }
    public var taxonomyClearLabel: String { strings(.plantsTaxonomyClear) }
    public var gardenAreaLabel: String { strings(.plantsGardenAreaLabel) }
    public var placementLabel: String { strings(.plantsPlacementLabel) }
    public var mapObjectIdHint: String { strings(.plantsMapObjectIdHint) }
    public var mapObjectPickerTitle: String { strings(.plantsMapObjectPickerTitle) }
    public var mapObjectPickerClearTitle: String { strings(.plantsMapObjectPickerClear) }
    public var mapObjectPickerEmptyMessage: String { strings(.plantsMapObjectPickerEmpty) }
    public var addSubmitTitle: String { strings(.plantsAddSubmit) }
    public var openSectionTitle: String { strings(.plantsOpenSectionTitle) }
    public var openIdLabel: String { strings(.plantsOpenIdLabel) }
    public var openSubmitTitle: String { strings(.plantsOpenSubmit) }
    public var openHint: String { strings(.plantsOpenHint) }
    public var taxonomyPickerTitle: String { strings(.plantsTaxonomyPickerTitle) }
    public var taxonomyPickerSearchLabel: String { strings(.plantsTaxonomyPickerSearchLabel) }
    public var taxonomyPickerEmptyMessage: String { strings(.plantsTaxonomyPickerEmpty) }
    public var closeTitle: String { strings(.plantsClose) }
    public var quantityUnitLabel: String { strings(.plantsQuantityUnit) }

    /// The date dial's four shortcuts, as words. They were previously rendered
    /// as formatted dates, so "Today" read as the same date the chip below it
    /// was already captioned with.
    public func relativeDayTitle(_ kind: RelativeDayOption.Kind) -> String {
        switch kind {
        case .today: strings(.relativeDayToday)
        case .tomorrow: strings(.relativeDayTomorrow)
        case .thisWeekend: strings(.relativeDayThisWeekend)
        case .nextWeek: strings(.relativeDayNextWeek)
        }
    }
    public var quantityIncreaseLabel: String { strings(.plantsQuantityIncrease) }
    public var quantityDecreaseLabel: String { strings(.plantsQuantityDecrease) }
    public var addFromPhotoButtonTitle: String { strings(.plantsAddFromPhotoButton) }

    public func groupingKindName(_ kind: PlantGroupingKind) -> String {
        PlantsLocalization.groupingKindName(kind, strings: strings)
    }

    public func acquisitionDateTypeName(_ type: PlantAcquisitionDateType) -> String {
        PlantsLocalization.acquisitionDateTypeName(type, strings: strings)
    }

    public func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        PlantsLocalization.taxonomyDisplayName(reference)
    }

    public var selectedTaxonomySummary: String {
        selectedTaxonomyReference.map(taxonomyDisplayName) ?? taxonomyNoneLabel
    }

    public var errorMessage: String? {
        guard case let .failed(message) = state else { return nil }
        return message
    }

    public func selectTaxonomy(_ reference: TaxonomyReference) {
        selectedTaxonomyReference = reference
        isTaxonomyPickerPresented = false
    }

    public func clearTaxonomy() {
        selectedTaxonomyReference = nil
    }

    /// Passed to `TaxonomyReferencePickerView` as its `search` closure. Never
    /// throws to the sheet — a search failure just shows no results, since
    /// leaving the plant unidentified is always a valid outcome of this form.
    public func searchTaxonomy(query: String) async -> [TaxonomyReference] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return (try? await searchTaxonomyReferences(gardenId: gardenId, query: trimmed.isEmpty ? nil : trimmed)) ?? []
    }

    /// This field's own current selection, resolved to its map object's
    /// label when the picker has already loaded the garden's objects —
    /// falls back to the raw id (still meaningful, if unfriendly) before
    /// that first load completes.
    public func mapObjectSummary(for field: MapObjectPlacementField) -> String? {
        let rawId = field == .gardenArea ? gardenAreaMapObjectId : placementMapObjectId
        guard !rawId.isEmpty else { return nil }
        return mapObjects.first { $0.id == rawId }?.label ?? rawId
    }

    /// Opens the picker for this field, loading the garden's active map
    /// objects on first use — never thrown to the sheet, the same "a search
    /// failure just shows no results" posture `searchTaxonomy` above uses.
    public func openMapObjectPicker(for field: MapObjectPlacementField) async {
        guard let listGardenMapObjects else { return }
        if mapObjects.isEmpty {
            mapObjects = (try? await listGardenMapObjects(gardenId: gardenId)) ?? []
        }
        activeMapObjectField = field
    }

    public func selectMapObject(_ objectId: String?) {
        guard let field = activeMapObjectField else { return }
        switch field {
        case .gardenArea: gardenAreaMapObjectId = objectId ?? ""
        case .placement: placementMapObjectId = objectId ?? ""
        }
        activeMapObjectField = nil
    }

    public func submitAddPlant() async {
        switch AddPlantFormValidation.resolve(
            displayName: displayName,
            groupingKind: groupingKind,
            quantityText: quantityText
        ) {
        case let .failure(failure):
            state = .failed(message: message(for: failure))
            return
        case let .success((resolvedName, resolvedQuantity)):
            await performAdd(displayName: resolvedName, quantity: resolvedQuantity)
        }
    }

    private func performAdd(displayName: String, quantity: Int?) async {
        state = .submitting

        do {
            let plant = try await addPlant(
                gardenId: gardenId,
                displayName: displayName,
                taxonomyReferenceId: selectedTaxonomyReference?.id,
                varietyLabel: varietyLabel.isEmpty ? nil : varietyLabel,
                acquisitionDate: hasAcquisitionDate ? CalendarDate.string(from: acquisitionDate) : nil,
                acquisitionDateType: hasAcquisitionDate ? acquisitionDateType : nil,
                groupingKind: groupingKind,
                quantity: quantity,
                gardenAreaMapObjectId: gardenAreaMapObjectId.isEmpty ? nil : gardenAreaMapObjectId,
                placementMapObjectId: placementMapObjectId.isEmpty ? nil : placementMapObjectId
            )
            resetAddForm()
            state = .idle
            navigateToPlantId = plant.id
        } catch let error as PlantCommandError {
            state = .failed(message: message(for: error))
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    public func openPlant() {
        let trimmed = openPlantId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        openPlantId = ""
        navigateToPlantId = trimmed
    }

    public func consumeNavigation() {
        navigateToPlantId = nil
    }

    private func resetAddForm() {
        displayName = ""
        groupingKind = .individual
        quantityText = ""
        varietyLabel = ""
        hasAcquisitionDate = false
        acquisitionDate = .now
        acquisitionDateType = .planted
        selectedTaxonomyReference = nil
        gardenAreaMapObjectId = ""
        placementMapObjectId = ""
    }

    private func message(for failure: AddPlantFormValidation.Failure) -> String {
        switch failure {
        case .displayNameRequired: strings(.plantsDisplayNameRequired)
        case .quantityRequired: strings(.plantsQuantityRequired)
        case .quantityMustBePositive: strings(.plantsQuantityMustBePositive)
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

    private func message(for failure: PlantCommandError) -> String {
        switch failure {
        case .invalidDisplayName:
            strings(.plantsDisplayNameRequired)
        case .localRecordNotFound, .payloadEncodingFailed, .conflictResolutionPayloadMalformed:
            strings(.serverUnexpected)
        }
    }
}
