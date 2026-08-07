/**
 * English messages for the candidates feature: the "plants being
 * considered" list, its filters, the add-candidate form, the detail page,
 * suitability review, and conversion into a real plant.
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-plants.ts` already documents.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * packages/api-contracts/openapi.yaml, tag `PlantCandidates`.
 */
export const englishCandidatesMessages = {
  'candidates.pageTitle': 'Candidates',
  'candidates.pageDescription': "Plants you're considering for this garden, not yet planted.",
  'candidates.searchLabel': 'Search by name',
  'candidates.filterLegend': 'Filter by status',
  'candidates.filterPriorityLegend': 'Filter by priority',
  'candidates.listLoading': 'Loading candidates.',
  'candidates.listLoadingMore': 'Loading more candidates.',
  'candidates.listRetry': 'Try again',
  'candidates.listEmpty': 'No candidates match the current search and filters.',
  'candidates.listLoadMore': 'Load more',
  'candidates.priorityDisplay': 'Priority: {priority}',
  'candidates.quantityDisplay': '{quantity} plants',

  'candidates.addTitle': 'Add a candidate',
  'candidates.addSubmit': 'Add candidate',
  'candidates.addFromPhotoTitle': 'Add from a photo',
  'candidates.addFromPhotoDescription':
    'Upload a photo of the plant. A candidate is created for you, prefilled with the AI’s guess at its species — edit or delete it afterward if the guess is wrong.',
  'candidates.addFromPhotoCreating': 'Creating the candidate from your photo…',
  'candidates.photoGalleryTitle': 'Photo',
  'candidates.photoOpenFullscreen': 'Open photo full screen',
  'candidates.photoCloseFullscreen': 'Close full-screen photo',
  'candidates.identificationTitle': 'Plant identification',
  'candidates.identificationDescription':
    'Identify this candidate again from its full-quality photo. Large originals are prepared automatically; no separate upload-size limit applies to identification.',
  'candidates.identificationAction': 'Identify from photo',
  'candidates.identificationPreparing': 'Preparing and identifying…',
  'candidates.identificationApplied': 'Identification applied.',
  'candidates.displayNameLabel': 'Display name',
  'candidates.displayNameRequired': 'Enter a name up to 200 characters.',
  'candidates.taxonomySearchLabel': 'Search the taxonomy catalog',
  'candidates.taxonomySelectLabel': 'Taxonomy reference',
  'candidates.taxonomyNone': 'Not identified',
  'candidates.taxonomySearchFailed': 'The taxonomy catalog could not be searched.',
  'candidates.varietyLabelLabel': 'Variety',
  'candidates.groupingKindLabel': 'Grouping',
  'candidates.quantityLabel': 'Quantity',
  'candidates.quantityInvalid':
    'Enter a quantity of 1 or more for a row or group; leave blank for an individual plant.',
  'candidates.rationaleNoteLabel': 'Rationale',
  'candidates.priorityLabel': 'Priority',
  'candidates.priorityNone': 'Not set',
  'candidates.priceAmountLabel': 'Price',
  'candidates.priceCurrencyLabel': 'Currency',
  'candidates.purchaseSourceLabel': 'Purchase source',
  'candidates.proposedGardenAreaMapObjectIdLabel': 'Proposed garden area',
  'candidates.proposedPlacementMapObjectIdLabel': 'Proposed placement',
  'candidates.mapObjectIdHint': 'Choose an object from this garden’s map.',
  'candidates.mapObjectNone': 'None',

  'candidates.backToCandidates': 'Back to candidates',
  'candidates.loading': 'Loading the candidate.',
  'candidates.notFoundTitle': 'This candidate could not be found.',
  'candidates.editTitle': 'Edit details',
  'candidates.saveDetails': 'Save details',
  'candidates.detailsSaved': 'Details saved.',

  'candidates.statusTitle': 'Status',
  'candidates.saveStatus': 'Save status',
  'candidates.statusSaved': 'Status saved.',

  'candidates.suitabilityTitle': 'Suitability for this garden',
  'candidates.suitabilityDescription':
    'Checked against this garden’s recorded context — hardiness, sun exposure, soil, drainage, and more. Missing context is shown honestly as unknown, never as a false match.',
  'candidates.suitabilityLoading': 'Loading the suitability assessment.',
  'candidates.suitabilityNone': 'No suitability assessment yet.',
  'candidates.suitabilityRecalculate': 'Check suitability',
  'candidates.suitabilityRecalculating': 'Checking…',
  'candidates.suitabilityEvidence': 'Evidence',
  'candidates.suitabilityAssumedValue': 'Assumed: {value}',

  'candidates.convertTitle': 'Convert to a plant',
  'candidates.deleteTitle': 'Delete permanently',
  'candidates.deleteExplanation':
    'Removes this candidate and its photos and suitability assessments for good. Archiving keeps the record and its history instead.',
  'candidates.deleteAction': 'Delete permanently',
  'candidates.deleteConfirm': 'Yes, delete it',
  'candidates.deleteCancel': 'Keep it',
  'candidates.convertDescription':
    'Creates a real plant from this candidate and marks the candidate converted. This cannot be undone.',
  'candidates.convertAcquisitionDateLabel': 'Acquisition date',
  'candidates.convertAcquisitionDateTypeLabel': 'Acquisition type',
  'candidates.convertAcquisitionDateTypeNone': 'Not specified',
  'candidates.convertSubmit': 'Convert to plant',
  'candidates.convertConfirm': 'Convert this candidate into a real plant in this garden?',
  'candidates.convertedViewPlant': 'View your plants',
  'candidates.alreadyConverted': 'This candidate has already been converted and cannot be edited.',

  'candidates.enum.groupingKind.individual': 'Individual',
  'candidates.enum.groupingKind.row': 'Row',
  'candidates.enum.groupingKind.group': 'Group',
  'candidates.enum.status.active': 'Active',
  'candidates.enum.status.converted': 'Converted',
  'candidates.enum.status.archived': 'Archived',
  'candidates.enum.status.rejected': 'Rejected',
  'candidates.enum.priority.low': 'Low',
  'candidates.enum.priority.medium': 'Medium',
  'candidates.enum.priority.high': 'High',

  'candidates.enum.acquisitionDateType.planted': 'Planted',
  'candidates.enum.acquisitionDateType.sown': 'Sown',
  'candidates.enum.acquisitionDateType.acquired': 'Acquired',

  'candidates.enum.suitabilityAxis.hardiness': 'Hardiness',
  'candidates.enum.suitabilityAxis.sunExposure': 'Sun exposure',
  'candidates.enum.suitabilityAxis.soilPh': 'Soil pH',
  'candidates.enum.suitabilityAxis.drainage': 'Drainage',
  'candidates.enum.suitabilityAxis.matureSpace': 'Mature space',
  'candidates.enum.suitabilityAxis.growingContext': 'Growing context',
  'candidates.enum.suitabilityAxis.structuralConflict': 'Structural conflict',
  'candidates.enum.suitabilityAxis.regulatoryStatus': 'Regulatory status',
  'candidates.enum.suitabilityAxis.userPreference': 'Preference',

  'candidates.enum.suitabilityCategory.match': 'Match',
  'candidates.enum.suitabilityCategory.caution': 'Caution',
  'candidates.enum.suitabilityCategory.blocker': 'Blocker',
  'candidates.enum.suitabilityCategory.unknown': 'Unknown',
  'candidates.enum.suitabilityCategory.assumption': 'Assumption',

  'candidates.enum.suitabilityUnknownReason.gardenContextMissing':
    'Garden context not recorded yet.',
  'candidates.enum.suitabilityUnknownReason.plantFactMissing': 'Not known for this plant yet.',
  'candidates.enum.suitabilityUnknownReason.placementMissing':
    'No placement chosen for this candidate.',
};
