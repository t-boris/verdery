/// Keys the plant-candidates feature (P11-WEB-01's iOS counterpart,
/// P11-IOS-01) resolves against the localization catalogue: the candidate
/// list and its filters, the add-candidate form, the detail/edit/status
/// screen, suitability review, and conversion into a real plant.
///
/// A second enum for `FeatureCandidates` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line
/// ceiling.
public enum PlantCandidatesLocalizationKey: String, Sendable, CaseIterable {
    case candidatesTitle = "candidates.title"
    case candidatesDescription = "candidates.description"
    case candidatesSearchLabel = "candidates.searchLabel"
    case candidatesFilterStatusLabel = "candidates.filter.statusLabel"
    case candidatesFilterPriorityLabel = "candidates.filter.priorityLabel"
    case candidatesLoading = "candidates.loading"
    case candidatesLoadingMore = "candidates.loadingMore"
    case candidatesRetry = "candidates.retry"
    case candidatesEmpty = "candidates.empty"
    case candidatesLoadMore = "candidates.loadMore"
    case candidatesAddButtonTitle = "candidates.addButtonTitle"

    case candidatesAddTitle = "candidates.add.title"
    case candidatesAddSubmit = "candidates.add.submit"
    case candidatesDisplayNameLabel = "candidates.displayNameLabel"
    case candidatesDisplayNameRequired = "candidates.displayNameRequired"
    case candidatesTaxonomyLabel = "candidates.taxonomyLabel"
    case candidatesTaxonomyNone = "candidates.taxonomyNone"
    case candidatesTaxonomyClear = "candidates.taxonomyClear"
    case candidatesTaxonomyPickerTitle = "candidates.taxonomyPickerTitle"
    case candidatesTaxonomyPickerSearchLabel = "candidates.taxonomyPickerSearchLabel"
    case candidatesTaxonomyPickerEmpty = "candidates.taxonomyPickerEmpty"
    case candidatesVarietyLabelLabel = "candidates.varietyLabelLabel"
    case candidatesGroupingKindLabel = "candidates.groupingKindLabel"
    case candidatesQuantityLabel = "candidates.quantityLabel"
    case candidatesQuantityRequired = "candidates.quantityRequired"
    case candidatesQuantityMustBePositive = "candidates.quantityMustBePositive"
    case candidatesRationaleNoteLabel = "candidates.rationaleNoteLabel"
    case candidatesPriorityLabel = "candidates.priorityLabel"
    case candidatesPriorityNone = "candidates.priorityNone"
    case candidatesPriceAmountLabel = "candidates.priceAmountLabel"
    case candidatesPriceCurrencyLabel = "candidates.priceCurrencyLabel"
    case candidatesPurchaseSourceLabel = "candidates.purchaseSourceLabel"
    case candidatesClose = "candidates.close"

    case candidatesLoadingDetail = "candidates.loadingDetail"
    case candidatesNotFound = "candidates.notFound"
    case candidatesEditTitle = "candidates.edit.title"
    case candidatesSaveDetails = "candidates.saveDetails"
    case candidatesDetailsSaved = "candidates.detailsSaved"
    case candidatesStatusTitle = "candidates.status.title"
    case candidatesSaveStatus = "candidates.status.save"
    case candidatesStatusSaved = "candidates.status.saved"
    case candidatesAlreadyConverted = "candidates.alreadyConverted"
    case candidatesConvertedViewPlant = "candidates.convertedViewPlant"

    case candidatesSuitabilityTitle = "candidates.suitability.title"
    case candidatesSuitabilityDescription = "candidates.suitability.description"
    case candidatesSuitabilityLoading = "candidates.suitability.loading"
    case candidatesSuitabilityNone = "candidates.suitability.none"
    case candidatesSuitabilityRecalculate = "candidates.suitability.recalculate"
    case candidatesSuitabilityRecalculating = "candidates.suitability.recalculating"
    case candidatesSuitabilityEvidence = "candidates.suitability.evidence"
    case candidatesSuitabilityAssumedValue = "candidates.suitability.assumedValue"

    case candidatesConvertTitle = "candidates.convert.title"
    case candidatesConvertDescription = "candidates.convert.description"
    case candidatesConvertAcquisitionDateToggle = "candidates.convert.acquisitionDateToggle"
    case candidatesConvertAcquisitionDateLabel = "candidates.convert.acquisitionDateLabel"
    case candidatesConvertAcquisitionDateTypeLabel = "candidates.convert.acquisitionDateTypeLabel"
    case candidatesConvertSubmit = "candidates.convert.submit"
    case candidatesConvertConfirm = "candidates.convert.confirm"

    case candidatesDeleteTitle = "candidates.delete.title"
    case candidatesDeleteDescription = "candidates.delete.description"
    case candidatesDeleteSubmit = "candidates.delete.submit"
    case candidatesDeleteConfirm = "candidates.delete.confirm"

    case candidatesGroupingKindIndividual = "candidates.enum.groupingKind.individual"
    case candidatesGroupingKindRow = "candidates.enum.groupingKind.row"
    case candidatesGroupingKindGroup = "candidates.enum.groupingKind.group"
    case candidatesStatusActive = "candidates.enum.status.active"
    case candidatesStatusConverted = "candidates.enum.status.converted"
    case candidatesStatusArchived = "candidates.enum.status.archived"
    case candidatesStatusRejected = "candidates.enum.status.rejected"
    case candidatesPriorityLow = "candidates.enum.priority.low"
    case candidatesPriorityMedium = "candidates.enum.priority.medium"
    case candidatesPriorityHigh = "candidates.enum.priority.high"
    case candidatesAcquisitionDateTypePlanted = "candidates.enum.acquisitionDateType.planted"
    case candidatesAcquisitionDateTypeSown = "candidates.enum.acquisitionDateType.sown"
    case candidatesAcquisitionDateTypeAcquired = "candidates.enum.acquisitionDateType.acquired"

    case candidatesSuitabilityAxisHardiness = "candidates.enum.suitabilityAxis.hardiness"
    case candidatesSuitabilityAxisSunExposure = "candidates.enum.suitabilityAxis.sunExposure"
    case candidatesSuitabilityAxisSoilPh = "candidates.enum.suitabilityAxis.soilPh"
    case candidatesSuitabilityAxisDrainage = "candidates.enum.suitabilityAxis.drainage"
    case candidatesSuitabilityAxisMatureSpace = "candidates.enum.suitabilityAxis.matureSpace"
    case candidatesSuitabilityAxisGrowingContext = "candidates.enum.suitabilityAxis.growingContext"
    case candidatesSuitabilityAxisStructuralConflict = "candidates.enum.suitabilityAxis.structuralConflict"
    case candidatesSuitabilityAxisRegulatoryStatus = "candidates.enum.suitabilityAxis.regulatoryStatus"
    case candidatesSuitabilityAxisUserPreference = "candidates.enum.suitabilityAxis.userPreference"

    case candidatesSuitabilityCategoryMatch = "candidates.enum.suitabilityCategory.match"
    case candidatesSuitabilityCategoryCaution = "candidates.enum.suitabilityCategory.caution"
    case candidatesSuitabilityCategoryBlocker = "candidates.enum.suitabilityCategory.blocker"
    case candidatesSuitabilityCategoryUnknown = "candidates.enum.suitabilityCategory.unknown"
    case candidatesSuitabilityCategoryAssumption = "candidates.enum.suitabilityCategory.assumption"

    case candidatesSuitabilityUnknownReasonGardenContextMissing =
        "candidates.enum.suitabilityUnknownReason.gardenContextMissing"
    case candidatesSuitabilityUnknownReasonPlantFactMissing =
        "candidates.enum.suitabilityUnknownReason.plantFactMissing"
    case candidatesSuitabilityUnknownReasonPlacementMissing =
        "candidates.enum.suitabilityUnknownReason.placementMissing"

    /// `MeasureField`'s two accessible adjust actions for a price. A drag with
    /// no spoken equivalent is a control that does not exist for a VoiceOver
    /// reader, so the component requires both names.
    case candidatesPriceIncrease = "candidates.price.increase"
    case candidatesPriceDecrease = "candidates.price.decrease"
}
