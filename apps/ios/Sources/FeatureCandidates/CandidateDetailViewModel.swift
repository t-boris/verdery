import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a single candidate: its facts and edit form, status
/// control, suitability assessment, and conversion into a real plant —
/// combines what `FeaturePlants` splits across `PlantDetailViewModel` and
/// several forms, since a candidate carries no photo gallery or
/// identification banner to also coordinate.
///
/// Once `status == .converted`, `saveDetails()`/`saveStatus()`/`convert()`
/// all refuse locally (`.alreadyConverted`) rather than reaching the
/// gateway — a converted candidate is a frozen historical record, matching
/// `apps/web/features/candidates/candidate-detail.tsx`'s own identical
/// gating.
///
/// Source: implementation-plan.md work package P11-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `PlantCandidates`.
@MainActor
@Observable
public final class CandidateDetailViewModel {
    public private(set) var state: CandidateDetailViewState = .loading

    // Edit-details form fields.
    public var displayName: String = ""
    public var varietyLabel: String = ""
    public var quantityText: String = ""
    public var rationaleNote: String = ""
    public var priority: PlantCandidatePriority?
    public var priceAmountText: String = ""
    public var priceCurrency: String = ""
    public var purchaseSource: String = ""
    public private(set) var selectedTaxonomyReference: TaxonomyReference?
    public var isTaxonomyPickerPresented: Bool = false
    public private(set) var isSavingDetails = false
    public private(set) var detailsErrorMessage: String?
    public private(set) var detailsSaved = false

    // Status control.
    public var selectedStatus: PlantCandidateStatus = .active
    public private(set) var isSavingStatus = false
    public private(set) var statusErrorMessage: String?
    public private(set) var statusSaved = false

    // Suitability.
    public private(set) var suitability: SuitabilityAssessment?
    public private(set) var isLoadingSuitability = false
    public private(set) var isRecalculatingSuitability = false
    public private(set) var suitabilityErrorMessage: String?

    // Convert-to-plant form.
    public var hasConvertAcquisitionDate = false
    public var convertAcquisitionDate: Date = .now
    public var convertAcquisitionDateType: PlantAcquisitionDateType = .planted
    public private(set) var isConverting = false
    public private(set) var convertErrorMessage: String?
    public private(set) var isDeleting = false
    public private(set) var deleteErrorMessage: String?
    /// Set once the row is gone, so the view can leave a detail screen that no longer has anything to show.
    public private(set) var didDelete = false
    public private(set) var convertedPlantId: String?

    public let gardenId: String
    public let candidateId: String
    private let getCandidate: GetCandidate
    private let updateCandidateDetails: UpdateCandidateDetails
    private let setCandidateStatus: SetCandidateStatus
    private let convertCandidate: ConvertCandidate
    private let deleteCandidate: DeleteCandidate
    private let getCandidateSuitability: GetCandidateSuitability
    private let recalculateCandidateSuitability: RecalculateCandidateSuitability
    private let searchTaxonomyReferences: SearchCandidateTaxonomyReferences
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        candidateId: String,
        getCandidate: GetCandidate,
        updateCandidateDetails: UpdateCandidateDetails,
        setCandidateStatus: SetCandidateStatus,
        convertCandidate: ConvertCandidate,
        deleteCandidate: DeleteCandidate,
        getCandidateSuitability: GetCandidateSuitability,
        recalculateCandidateSuitability: RecalculateCandidateSuitability,
        searchTaxonomyReferences: SearchCandidateTaxonomyReferences,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.candidateId = candidateId
        self.getCandidate = getCandidate
        self.updateCandidateDetails = updateCandidateDetails
        self.setCandidateStatus = setCandidateStatus
        self.convertCandidate = convertCandidate
        self.deleteCandidate = deleteCandidate
        self.getCandidateSuitability = getCandidateSuitability
        self.recalculateCandidateSuitability = recalculateCandidateSuitability
        self.searchTaxonomyReferences = searchTaxonomyReferences
        self.strings = strings
    }

    public var loadingMessage: String { strings(.candidatesLoadingDetail) }
    public var notFoundMessage: String { strings(.candidatesNotFound) }
    public var editTitle: String { strings(.candidatesEditTitle) }
    public var displayNameLabel: String { strings(.candidatesDisplayNameLabel) }
    public var taxonomyLabel: String { strings(.candidatesTaxonomyLabel) }
    public var taxonomyNoneLabel: String { strings(.candidatesTaxonomyNone) }
    public var taxonomyClearLabel: String { strings(.candidatesTaxonomyClear) }
    public var taxonomyPickerTitle: String { strings(.candidatesTaxonomyPickerTitle) }
    public var taxonomyPickerSearchLabel: String { strings(.candidatesTaxonomyPickerSearchLabel) }
    public var taxonomyPickerEmptyMessage: String { strings(.candidatesTaxonomyPickerEmpty) }
    public var varietyLabelLabel: String { strings(.candidatesVarietyLabelLabel) }
    public var quantityLabel: String { strings(.candidatesQuantityLabel) }
    public var rationaleNoteLabel: String { strings(.candidatesRationaleNoteLabel) }
    public var priorityLabel: String { strings(.candidatesPriorityLabel) }
    public var priorityNoneLabel: String { strings(.candidatesPriorityNone) }
    public var priceAmountLabel: String { strings(.candidatesPriceAmountLabel) }
    public var priceCurrencyLabel: String { strings(.candidatesPriceCurrencyLabel) }
    public var purchaseSourceLabel: String { strings(.candidatesPurchaseSourceLabel) }
    public var saveDetailsTitle: String { strings(.candidatesSaveDetails) }
    public var detailsSavedMessage: String { strings(.candidatesDetailsSaved) }
    public var closeTitle: String { strings(.candidatesClose) }
    public var quantityUnitLabel: String { strings(.plantsQuantityUnit) }
    public var quantityIncreaseLabel: String { strings(.plantsQuantityIncrease) }
    public var quantityDecreaseLabel: String { strings(.plantsQuantityDecrease) }
    public var priceIncreaseLabel: String { strings(.candidatesPriceIncrease) }
    public var priceDecreaseLabel: String { strings(.candidatesPriceDecrease) }

    /// The date dial's four shortcuts, as words rather than as dates.
    public func relativeDayTitle(_ kind: RelativeDayOption.Kind) -> String {
        switch kind {
        case .today: strings(.relativeDayToday)
        case .tomorrow: strings(.relativeDayTomorrow)
        case .thisWeekend: strings(.relativeDayThisWeekend)
        case .nextWeek: strings(.relativeDayNextWeek)
        }
    }

    public var statusTitle: String { strings(.candidatesStatusTitle) }
    public var saveStatusTitle: String { strings(.candidatesSaveStatus) }
    public var statusSavedMessage: String { strings(.candidatesStatusSaved) }
    public var alreadyConvertedMessage: String { strings(.candidatesAlreadyConverted) }

    public var suitabilityTitle: String { strings(.candidatesSuitabilityTitle) }
    public var suitabilityDescription: String { strings(.candidatesSuitabilityDescription) }
    public var suitabilityLoadingMessage: String { strings(.candidatesSuitabilityLoading) }
    public var suitabilityNoneMessage: String { strings(.candidatesSuitabilityNone) }
    public var suitabilityRecalculateTitle: String { strings(.candidatesSuitabilityRecalculate) }
    public var suitabilityRecalculatingTitle: String { strings(.candidatesSuitabilityRecalculating) }
    public var suitabilityEvidenceLabel: String { strings(.candidatesSuitabilityEvidence) }

    public var convertTitle: String { strings(.candidatesConvertTitle) }
    public var convertDescription: String { strings(.candidatesConvertDescription) }
    public var convertAcquisitionDateToggleLabel: String { strings(.candidatesConvertAcquisitionDateToggle) }
    public var convertAcquisitionDateLabel: String { strings(.candidatesConvertAcquisitionDateLabel) }
    public var convertAcquisitionDateTypeLabel: String { strings(.candidatesConvertAcquisitionDateTypeLabel) }
    public var convertSubmitTitle: String { strings(.candidatesConvertSubmit) }
    public var deleteTitle: String { strings(.candidatesDeleteTitle) }
    public var deleteDescription: String { strings(.candidatesDeleteDescription) }
    public var deleteSubmitTitle: String { strings(.candidatesDeleteSubmit) }
    public var deleteConfirmTitle: String { strings(.candidatesDeleteConfirm) }

    public func statusName(_ status: PlantCandidateStatus) -> String {
        CandidatesLocalization.statusName(status, strings: strings)
    }

    public func priorityName(_ priority: PlantCandidatePriority) -> String {
        CandidatesLocalization.priorityName(priority, strings: strings)
    }

    public func acquisitionDateTypeName(_ type: PlantAcquisitionDateType) -> String {
        CandidatesLocalization.acquisitionDateTypeName(type, strings: strings)
    }

    public func axisName(_ axis: SuitabilityAxis) -> String {
        CandidatesLocalization.axisName(axis, strings: strings)
    }

    public func categoryName(_ category: SuitabilityFindingCategory) -> String {
        CandidatesLocalization.categoryName(category, strings: strings)
    }

    public func categoryTone(_ category: SuitabilityFindingCategory) -> Tone {
        CandidatesLocalization.tone(for: category)
    }

    public func unknownReasonName(_ reason: SuitabilityUnknownReason) -> String {
        CandidatesLocalization.unknownReasonName(reason, strings: strings)
    }

    public func assumedValueText(_ value: JSONValue) -> String {
        strings.string(.candidatesSuitabilityAssumedValue, parameters: ["value": CandidatesLocalization.displayText(value)])
    }

    public func evidenceValueText(_ value: JSONValue) -> String {
        CandidatesLocalization.displayText(value)
    }

    public func taxonomyDisplayName(_ reference: TaxonomyReference) -> String {
        CandidatesLocalization.taxonomyDisplayName(reference)
    }

    public var selectedTaxonomySummary: String {
        selectedTaxonomyReference.map(taxonomyDisplayName) ?? taxonomyNoneLabel
    }

    /// Every status a manual transition can select — never `.converted`,
    /// the same exclusion `SetCandidateStatusRequestTransport`'s own doc
    /// comment enforces server-side.
    public static let settableStatuses: [PlantCandidateStatus] = PlantCandidateStatus.allCases.filter { $0 != .converted }

    public var isConverted: Bool {
        guard case let .loaded(candidate) = state else { return false }
        return candidate.status == .converted
    }

    public func selectTaxonomy(_ reference: TaxonomyReference) {
        selectedTaxonomyReference = reference
        isTaxonomyPickerPresented = false
    }

    public func clearTaxonomy() {
        selectedTaxonomyReference = nil
    }

    public func searchTaxonomy(query: String) async -> [TaxonomyReference] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return (try? await searchTaxonomyReferences(gardenId: gardenId, query: trimmed.isEmpty ? nil : trimmed)) ?? []
    }

    public func load() async {
        state = .loading
        do {
            let candidate = try await getCandidate(gardenId: gardenId, candidateId: candidateId)
            applyLoadedCandidate(candidate)
            state = .loaded(candidate)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
        await loadSuitability()
    }

    private func applyLoadedCandidate(_ candidate: PlantCandidate) {
        displayName = candidate.displayName
        varietyLabel = candidate.varietyLabel ?? ""
        quantityText = candidate.quantity.map(String.init) ?? ""
        rationaleNote = candidate.rationaleNote ?? ""
        priority = candidate.priority
        priceAmountText = candidate.priceAmount.map { String($0) } ?? ""
        priceCurrency = candidate.priceCurrency ?? ""
        purchaseSource = candidate.purchaseSource ?? ""
        selectedStatus = candidate.status == .converted ? .active : candidate.status
    }

    public func saveDetails() async {
        guard case let .loaded(candidate) = state, candidate.status != .converted else {
            detailsErrorMessage = alreadyConvertedMessage
            return
        }

        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, trimmedName.count <= 200 else {
            detailsErrorMessage = strings(.candidatesDisplayNameRequired)
            return
        }

        isSavingDetails = true
        detailsErrorMessage = nil
        detailsSaved = false
        defer { isSavingDetails = false }

        do {
            let updated = try await updateCandidateDetails(
                gardenId: gardenId,
                candidateId: candidateId,
                displayName: trimmedName,
                taxonomyReferenceId: .set(selectedTaxonomyReference?.id),
                varietyLabel: .set(varietyLabel.isEmpty ? nil : varietyLabel),
                quantity: candidate.groupingKind == .individual ? .unchanged : .set(Int(quantityText)),
                rationaleNote: .set(rationaleNote.isEmpty ? nil : rationaleNote),
                priority: .set(priority),
                priceAmount: .set(Double(priceAmountText)),
                priceCurrency: .set(priceCurrency.isEmpty ? nil : priceCurrency),
                purchaseSource: .set(purchaseSource.isEmpty ? nil : purchaseSource),
                expectedRevision: candidate.revision
            )
            state = .loaded(updated)
            detailsSaved = true
        } catch let error as APIGatewayError {
            detailsErrorMessage = message(for: error)
        } catch {
            detailsErrorMessage = strings(.serverUnexpected)
        }
    }

    public func saveStatus() async {
        guard case let .loaded(candidate) = state, candidate.status != .converted else {
            statusErrorMessage = alreadyConvertedMessage
            return
        }
        guard selectedStatus != candidate.status else { return }

        isSavingStatus = true
        statusErrorMessage = nil
        statusSaved = false
        defer { isSavingStatus = false }

        do {
            let updated = try await setCandidateStatus(
                gardenId: gardenId, candidateId: candidateId, status: selectedStatus,
                expectedRevision: candidate.revision
            )
            state = .loaded(updated)
            statusSaved = true
        } catch let error as APIGatewayError {
            statusErrorMessage = message(for: error)
        } catch {
            statusErrorMessage = strings(.serverUnexpected)
        }
    }

    public func loadSuitability() async {
        isLoadingSuitability = true
        suitabilityErrorMessage = nil
        defer { isLoadingSuitability = false }

        do {
            suitability = try await getCandidateSuitability(gardenId: gardenId, candidateId: candidateId)
        } catch let error as APIGatewayError {
            suitabilityErrorMessage = message(for: error)
        } catch {
            suitabilityErrorMessage = strings(.serverUnexpected)
        }
    }

    public func recalculateSuitability() async {
        isRecalculatingSuitability = true
        suitabilityErrorMessage = nil
        defer { isRecalculatingSuitability = false }

        do {
            suitability = try await recalculateCandidateSuitability(gardenId: gardenId, candidateId: candidateId)
        } catch let error as APIGatewayError {
            suitabilityErrorMessage = message(for: error)
        } catch {
            suitabilityErrorMessage = strings(.serverUnexpected)
        }
    }

    /// `gardenAreaMapObjectId`/`placementMapObjectId` are left unset — both
    /// default to the candidate's own proposed placement when omitted (the
    /// operation's own contract description), matching
    /// `apps/web/features/candidates/candidate-convert-form.tsx`'s identical
    /// choice not to show a placement picker here.
    public func convert() async {
        guard case let .loaded(candidate) = state, candidate.status != .converted else {
            convertErrorMessage = alreadyConvertedMessage
            return
        }

        isConverting = true
        convertErrorMessage = nil
        defer { isConverting = false }

        do {
            let result = try await convertCandidate(
                gardenId: gardenId,
                candidateId: candidateId,
                acquisitionDate: hasConvertAcquisitionDate ? CalendarDate.string(from: convertAcquisitionDate) : nil,
                acquisitionDateType: hasConvertAcquisitionDate ? convertAcquisitionDateType : nil,
                expectedRevision: candidate.revision
            )
            state = .loaded(result.candidate)
            convertedPlantId = result.plant.id
        } catch let error as APIGatewayError {
            convertErrorMessage = message(for: error)
        } catch {
            convertErrorMessage = strings(.serverUnexpected)
        }
    }

    /// Permanent removal. Refused for a `.converted` candidate before the
    /// request is made, matching the API's own refusal rather than sending a
    /// call that can only fail.
    public func delete() async {
        guard case let .loaded(candidate) = state, candidate.status != .converted else {
            deleteErrorMessage = alreadyConvertedMessage
            return
        }

        isDeleting = true
        deleteErrorMessage = nil
        defer { isDeleting = false }

        do {
            try await deleteCandidate(
                gardenId: gardenId,
                candidateId: candidateId,
                expectedRevision: candidate.revision
            )
            didDelete = true
        } catch let error as APIGatewayError {
            deleteErrorMessage = message(for: error)
        } catch {
            deleteErrorMessage = strings(.serverUnexpected)
        }
    }

    public func consumeConvertNavigation() {
        convertedPlantId = nil
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
