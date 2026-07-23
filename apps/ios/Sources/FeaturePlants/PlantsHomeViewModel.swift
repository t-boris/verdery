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
    /// TODO(P4-IOS-01): a real map-object picker, reusing `FeatureMap`'s
    /// object list read-only, is out of scope this pass — `FeaturePlants`
    /// cannot depend on `FeatureMap` at all (`DependencyRuleTests`: "No
    /// feature depends on another feature"), and bridging one through
    /// `AppComposition` for a single text field is disproportionate here.
    /// These stay plain object-id fields until a follow-up pass wires a
    /// real picker through the composition root.
    public var gardenAreaMapObjectId: String = ""
    public var placementMapObjectId: String = ""
    public var isTaxonomyPickerPresented: Bool = false

    // "Open a plant" field.
    public var openPlantId: String = ""

    public private(set) var navigateToPlantId: String?

    private let addPlant: AddPlant
    private let searchTaxonomyReferences: SearchTaxonomyReferences
    private let strings: LocalizedStrings
    let gardenId: String

    public init(
        gardenId: String,
        addPlant: AddPlant,
        searchTaxonomyReferences: SearchTaxonomyReferences,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.addPlant = addPlant
        self.searchTaxonomyReferences = searchTaxonomyReferences
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
    public var addSubmitTitle: String { strings(.plantsAddSubmit) }
    public var openSectionTitle: String { strings(.plantsOpenSectionTitle) }
    public var openIdLabel: String { strings(.plantsOpenIdLabel) }
    public var openSubmitTitle: String { strings(.plantsOpenSubmit) }
    public var openHint: String { strings(.plantsOpenHint) }
    public var taxonomyPickerTitle: String { strings(.plantsTaxonomyPickerTitle) }
    public var taxonomyPickerSearchLabel: String { strings(.plantsTaxonomyPickerSearchLabel) }
    public var taxonomyPickerEmptyMessage: String { strings(.plantsTaxonomyPickerEmpty) }
    public var closeTitle: String { strings(.plantsClose) }

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
