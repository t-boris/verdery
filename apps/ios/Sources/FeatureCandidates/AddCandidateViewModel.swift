import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for the "Add a candidate" form.
///
/// Two `AddCandidateRequest` fields are deliberately not collected here, a
/// real, separate follow-up rather than a silent drop: `proposedGardenArea
/// MapObjectId`/`proposedPlacementMapObjectId` (add-only — `Update
/// CandidateDetailsRequest` excludes them from `PATCH` too) would need
/// either a local duplicate of `FeaturePlants.MapObjectPickerView`'s full
/// sheet (a feature must not import another feature) or a real shared
/// component this pass does not build; `alternativeToCandidateId` needs a
/// candidate picker this pass does not build either — the same scope
/// decision `apps/web/features/candidates/add-candidate-form.tsx` already
/// made for both fields.
///
/// Source: implementation-plan.md work package P11-IOS-01;
/// packages/api-contracts/openapi.yaml, operation `addCandidate`.
@MainActor
@Observable
public final class AddCandidateViewModel {
    public private(set) var state: AddCandidateViewState = .idle

    public var displayName: String = ""
    public var groupingKind: PlantGroupingKind = .individual
    public var quantityText: String = ""
    public var varietyLabel: String = ""
    public var rationaleNote: String = ""
    public var priority: PlantCandidatePriority?
    public var priceAmountText: String = ""
    public var priceCurrency: String = ""
    public var purchaseSource: String = ""
    public private(set) var selectedTaxonomyReference: TaxonomyReference?
    public var isTaxonomyPickerPresented: Bool = false

    public private(set) var createdCandidateId: String?

    private let addCandidate: AddCandidate
    private let searchTaxonomyReferences: SearchCandidateTaxonomyReferences
    private let strings: LocalizedStrings
    let gardenId: String

    public init(
        gardenId: String,
        addCandidate: AddCandidate,
        searchTaxonomyReferences: SearchCandidateTaxonomyReferences,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.addCandidate = addCandidate
        self.searchTaxonomyReferences = searchTaxonomyReferences
        self.strings = strings
    }

    public var title: String { strings(.candidatesAddTitle) }
    public var displayNameLabel: String { strings(.candidatesDisplayNameLabel) }
    public var taxonomyLabel: String { strings(.candidatesTaxonomyLabel) }
    public var taxonomyNoneLabel: String { strings(.candidatesTaxonomyNone) }
    public var taxonomyClearLabel: String { strings(.candidatesTaxonomyClear) }
    public var taxonomyPickerTitle: String { strings(.candidatesTaxonomyPickerTitle) }
    public var taxonomyPickerSearchLabel: String { strings(.candidatesTaxonomyPickerSearchLabel) }
    public var taxonomyPickerEmptyMessage: String { strings(.candidatesTaxonomyPickerEmpty) }
    public var varietyLabelLabel: String { strings(.candidatesVarietyLabelLabel) }
    public var groupingKindLabel: String { strings(.candidatesGroupingKindLabel) }
    public var quantityLabel: String { strings(.candidatesQuantityLabel) }
    public var rationaleNoteLabel: String { strings(.candidatesRationaleNoteLabel) }
    public var priorityLabel: String { strings(.candidatesPriorityLabel) }
    public var priorityNoneLabel: String { strings(.candidatesPriorityNone) }
    public var priceAmountLabel: String { strings(.candidatesPriceAmountLabel) }
    public var priceCurrencyLabel: String { strings(.candidatesPriceCurrencyLabel) }
    public var purchaseSourceLabel: String { strings(.candidatesPurchaseSourceLabel) }
    public var submitTitle: String { strings(.candidatesAddSubmit) }
    public var closeTitle: String { strings(.candidatesClose) }

    public func groupingKindName(_ kind: PlantGroupingKind) -> String {
        CandidatesLocalization.groupingKindName(kind, strings: strings)
    }

    public func priorityName(_ priority: PlantCandidatePriority) -> String {
        CandidatesLocalization.priorityName(priority, strings: strings)
    }

    public func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        CandidatesLocalization.taxonomyDisplayName(reference)
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

    /// Never throws to the sheet — a search failure just shows no results,
    /// since leaving the candidate unidentified is always a valid outcome.
    public func searchTaxonomy(query: String) async -> [TaxonomyReference] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return (try? await searchTaxonomyReferences(gardenId: gardenId, query: trimmed.isEmpty ? nil : trimmed)) ?? []
    }

    public func submit() async {
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, trimmedName.count <= 200 else {
            state = .failed(message: strings(.candidatesDisplayNameRequired))
            return
        }

        let trimmedQuantity = quantityText.trimmingCharacters(in: .whitespacesAndNewlines)
        let quantity: Int?
        if groupingKind == .individual {
            quantity = nil
        } else {
            guard !trimmedQuantity.isEmpty else {
                state = .failed(message: strings(.candidatesQuantityRequired))
                return
            }
            guard let parsed = Int(trimmedQuantity), parsed >= 1 else {
                state = .failed(message: strings(.candidatesQuantityMustBePositive))
                return
            }
            quantity = parsed
        }

        state = .submitting

        do {
            let candidate = try await addCandidate(
                gardenId: gardenId,
                displayName: trimmedName,
                taxonomyReferenceId: selectedTaxonomyReference?.id,
                varietyLabel: varietyLabel.isEmpty ? nil : varietyLabel,
                groupingKind: groupingKind,
                quantity: quantity,
                rationaleNote: rationaleNote.isEmpty ? nil : rationaleNote,
                priority: priority,
                priceAmount: Double(priceAmountText),
                priceCurrency: priceCurrency.isEmpty ? nil : priceCurrency,
                purchaseSource: purchaseSource.isEmpty ? nil : purchaseSource
            )
            resetForm()
            state = .idle
            createdCandidateId = candidate.id
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    public func consumeNavigation() {
        createdCandidateId = nil
    }

    private func resetForm() {
        displayName = ""
        groupingKind = .individual
        quantityText = ""
        varietyLabel = ""
        rationaleNote = ""
        priority = nil
        priceAmountText = ""
        priceCurrency = ""
        purchaseSource = ""
        selectedTaxonomyReference = nil
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

public enum AddCandidateViewState: Equatable {
    case idle
    case submitting
    case failed(message: String)
}
