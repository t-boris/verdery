/// Keys the application resolves against the localization catalogue.
///
/// Feature code refers to these constants instead of typing a literal, so a key
/// that is removed from the catalogue fails to compile rather than rendering as
/// its own name at runtime.
///
/// Geometry validation keys are not listed here: their keys are the stable issue
/// codes emitted by CoreDomain, and duplicating them would create a second
/// source of truth.
public enum LocalizationKey: String, Sendable, CaseIterable {
    case networkUnreachable = "error.network.unreachable"
    case serverUnexpected = "error.server.unexpected"

    case healthTitle = "health.title"
    case healthStatusChecking = "health.status.checking"
    case healthStatusReady = "health.status.ready"
    case healthStatusNotReady = "health.status.notReady"
    case healthStatusUnreachable = "health.status.unreachable"
    case healthVersion = "health.version"
    case healthDependencyUnavailable = "health.dependency.unavailable"
    case healthActionRefresh = "health.action.refresh"

    case authSignInTitle = "auth.signIn.title"
    case authSignInDescription = "auth.signIn.description"
    case authSignInGoogle = "auth.signIn.google"
    case authSignInApple = "auth.signIn.apple"
    case authSignInEmailLabel = "auth.signIn.emailLabel"
    case authSignInEmailSubmit = "auth.signIn.emailSubmit"
    case authSignInEmailSent = "auth.signIn.emailSent"
    case authSignInEmailSentDescription = "auth.signIn.emailSentDescription"
    case authSignInFailed = "auth.signIn.failed"

    case shellSignOut = "shell.signOut"

    case gardensTitle = "gardens.title"
    case gardensEmpty = "gardens.empty"
    case gardensLoading = "gardens.loading"
    case gardensRetry = "gardens.retry"
    case gardensCreateTitle = "gardens.create.title"
    case gardensCreateNameLabel = "gardens.create.nameLabel"
    case gardensCreateSubmit = "gardens.create.submit"
    case gardensNameRequired = "gardens.name.required"
    case gardensSavedLocally = "gardens.status.savedLocally"
    case gardensLifecycleActive = "gardens.lifecycle.active"
    case gardensLifecycleArchived = "gardens.lifecycle.archived"
    case gardensLifecycleDeletionRequested = "gardens.lifecycle.deletionRequested"
    case gardensRoleOwner = "gardens.role.owner"
    case gardensRoleEditor = "gardens.role.editor"
    case gardensRoleViewer = "gardens.role.viewer"
    case gardensSettingsTitle = "gardens.settings.title"
    case gardensRenameTitle = "gardens.rename.title"
    case gardensRenameSubmit = "gardens.rename.submit"
    case gardensManageTitle = "gardens.manage.title"
    case gardensArchive = "gardens.archive"
    case gardensArchiveConfirm = "gardens.archive.confirm"
    case gardensRequestDeletion = "gardens.requestDeletion"
    case gardensRequestDeletionConfirm = "gardens.requestDeletion.confirm"
    case gardensOpenMapEditor = "gardens.openMapEditor"
    case gardensOpenPlants = "gardens.openPlants"
    case gardensOpenObservations = "gardens.openObservations"
    case gardensOpenTasks = "gardens.openTasks"
    case gardensOpenSyncConflicts = "gardens.openSyncConflicts"

    // Map editor: one display-name key per `GardenObjectCategory`, so the
    // toolbar, the property sheet, and the accessible list all read the same
    // name for a category.
    case mapCategoryLot = "map.category.lot"
    case mapCategoryStructure = "map.category.structure"
    case mapCategoryFence = "map.category.fence"
    case mapCategoryGate = "map.category.gate"
    case mapCategoryPath = "map.category.path"
    case mapCategoryZone = "map.category.zone"
    case mapCategoryBed = "map.category.bed"
    case mapCategoryWaterFeature = "map.category.waterFeature"
    case mapCategoryUtilityExclusion = "map.category.utilityExclusion"
    case mapCategoryTree = "map.category.tree"
    case mapCategoryPlant = "map.category.plant"
    case mapCategoryAnnotation = "map.category.annotation"
    case mapCategoryImportedBackground = "map.category.importedBackground"

    case mapEditorTitle = "map.editor.title"
    case mapEditorLoading = "map.editor.loading"
    case mapEditorRetry = "map.editor.retry"
    case mapTabCanvas = "map.tab.canvas"
    case mapTabList = "map.tab.list"
    /// Accessible name for the canvas/list segmented control itself. The two
    /// segment titles above name the *options*; without this the control had
    /// no name of its own, so VoiceOver announced only "selected, Canvas".
    case mapTabPickerLabel = "map.tab.pickerLabel"
    /// What the canvas tells VoiceOver about itself. The canvas is a
    /// direct-manipulation surface with no VoiceOver equivalent for drawing
    /// or dragging; saying so, and naming the alternative, is more useful
    /// than the silence `.accessibilityHidden(true)` produced.
    case mapCanvasAccessibilityLabel = "map.canvas.accessibilityLabel"
    case mapUndo = "map.undo"
    case mapRedo = "map.redo"
    case mapUndoUnavailable = "map.undo.unavailable"
    case mapCreateSectionTitle = "map.create.sectionTitle"
    case mapCreateHint = "map.create.hint"
    case mapCreateCancel = "map.create.cancel"

    case mapListEmpty = "map.list.empty"
    case mapListUntitled = "map.list.untitled"
    case mapListDeletedSuffix = "map.list.deletedSuffix"
    case mapListDeleteAction = "map.list.deleteAction"
    case mapListRestoreAction = "map.list.restoreAction"

    case mapPropertyTitle = "map.property.title"
    case mapPropertyClose = "map.property.close"
    case mapPropertyLabelField = "map.property.labelField"
    case mapPropertySave = "map.property.save"
    case mapPropertyDelete = "map.property.delete"
    case mapPropertyRestore = "map.property.restore"
    case mapPropertyDetailsTitle = "map.property.detailsTitle"
    case mapPropertyDetailsUnavailable = "map.property.detailsUnavailable"
    case mapPropertyMeasurementArea = "map.property.measurementArea"
    case mapPropertyMeasurementLength = "map.property.measurementLength"
    case mapPropertyEditShape = "map.property.editShape"
    case mapPropertyDuplicate = "map.property.duplicate"

    case mapStructureKindLabel = "map.structure.kindLabel"
    case mapStructureHeightLabel = "map.structure.heightLabel"
    case mapStructureKindHouse = "map.structureKind.house"
    case mapStructureKindShed = "map.structureKind.shed"
    case mapStructureKindGreenhouse = "map.structureKind.greenhouse"
    case mapStructureKindDeck = "map.structureKind.deck"
    case mapStructureKindGarage = "map.structureKind.garage"
    case mapStructureKindOther = "map.structureKind.other"

    case mapFenceKindLabel = "map.fence.kindLabel"
    case mapFenceHeightLabel = "map.fence.heightLabel"
    case mapFenceKindWood = "map.fenceKind.wood"
    case mapFenceKindChainLink = "map.fenceKind.chainLink"
    case mapFenceKindVinyl = "map.fenceKind.vinyl"
    case mapFenceKindMetal = "map.fenceKind.metal"
    case mapFenceKindHedge = "map.fenceKind.hedge"
    case mapFenceKindOther = "map.fenceKind.other"

    case mapTreeCommonNameLabel = "map.tree.commonNameLabel"
    case mapTreeHeightLabel = "map.tree.heightLabel"
    case mapTreeSpreadLabel = "map.tree.spreadLabel"

    case mapPlantCommonNameLabel = "map.plant.commonNameLabel"
    case mapPlantQuantityLabel = "map.plant.quantityLabel"
    case mapPlantSpacingLabel = "map.plant.spacingLabel"
    case mapPlantAssignedToLabel = "map.plant.assignedToLabel"
    case mapPlantAssignedToNone = "map.plant.assignedToNone"

    // Map editor: gate details and gate placement.
    case mapGateWidthLabel = "map.gate.widthLabel"
    case mapGateFenceLabel = "map.gate.fenceLabel"
    case mapCreateGateNoFence = "map.create.gateNoFence"
    case mapGatePickerTitle = "map.gatePicker.title"

    // Map editor: zone details.
    case mapZoneKindLabel = "map.zone.kindLabel"
    case mapZoneKindLawn = "map.zoneKind.lawn"
    case mapZoneKindGarden = "map.zoneKind.garden"
    case mapZoneKindMulch = "map.zoneKind.mulch"
    case mapZoneKindGravel = "map.zoneKind.gravel"
    case mapZoneKindGroundCover = "map.zoneKind.groundCover"
    case mapZoneKindOther = "map.zoneKind.other"

    // Map editor: bed details.
    case mapBedKindLabel = "map.bed.kindLabel"
    case mapBedSoilNotesLabel = "map.bed.soilNotesLabel"
    case mapBedKindInGround = "map.bedKind.inGround"
    case mapBedKindRaised = "map.bedKind.raised"
    case mapBedKindContainer = "map.bedKind.container"

    // Map editor: utility exclusion details.
    case mapUtilityExclusionKindLabel = "map.utilityExclusion.kindLabel"
    case mapUtilityExclusionNotesLabel = "map.utilityExclusion.notesLabel"
    case mapUtilityExclusionKindUndergroundUtility = "map.utilityExclusionKind.undergroundUtility"
    case mapUtilityExclusionKindSepticField = "map.utilityExclusionKind.septicField"
    case mapUtilityExclusionKindWellRadius = "map.utilityExclusionKind.wellRadius"
    case mapUtilityExclusionKindSetback = "map.utilityExclusionKind.setback"
    case mapUtilityExclusionKindOther = "map.utilityExclusionKind.other"

    // Map editor: annotation details.
    case mapAnnotationMeasurementValueLabel = "map.annotation.measurementValueLabel"
    case mapAnnotationMeasurementUnitLabel = "map.annotation.measurementUnitLabel"
    case mapMeasurementUnitMetres = "map.measurementUnit.metres"
    case mapMeasurementUnitSquareMetres = "map.measurementUnit.squareMetres"
    case mapMeasurementUnitDegrees = "map.measurementUnit.degrees"

    // Map editor: vertex-level shape editing (reshape, resize, rotate).
    case mapVertexEditHint = "map.vertexEdit.hint"
    case mapVertexEditDone = "map.vertexEdit.done"
    case mapVertexEditRemove = "map.vertexEdit.remove"
    case mapVertexEditSplitHere = "map.vertexEdit.splitHere"
    case mapVertexEditSnapDisable = "map.vertexEdit.snapDisable"
    case mapVertexEditSnapEnable = "map.vertexEdit.snapEnable"

    // Map editor: splitting and joining fence/path linework.
    case mapLineworkJoinStart = "map.linework.joinStart"
    case mapLineworkJoinHint = "map.linework.joinHint"
    case mapLineworkJoinCancel = "map.linework.joinCancel"
    case mapLineworkJoinIncompatible = "map.linework.joinIncompatible"

    // Map editor: layer visibility/locking (P3-UX-01). One display-name key
    // per `MapLayer`, mirroring the category keys above.
    case mapLayersButtonTitle = "map.layers.buttonTitle"
    case mapLayersTitle = "map.layers.title"
    case mapLayersClose = "map.layers.close"
    case mapLayerImportedBackgrounds = "map.layer.importedBackgrounds"
    case mapLayerLotAndStructures = "map.layer.lotAndStructures"
    case mapLayerZonesAndLinework = "map.layer.zonesAndLinework"
    case mapLayerPlantsAndAnnotations = "map.layer.plantsAndAnnotations"
    case mapLayersHideAction = "map.layers.hideAction"
    case mapLayersShowAction = "map.layers.showAction"
    case mapLayersLockAction = "map.layers.lockAction"
    case mapLayersUnlockAction = "map.layers.unlockAction"

    // Map editor: scale/accuracy presentation (P3-UX-01).
    case mapScaleGeoreferenced = "map.scale.georeferenced"
    case mapScaleGeoreferencedWithAccuracy = "map.scale.georeferencedWithAccuracy"
    case mapScaleNotSet = "map.scale.notSet"

    // Map editor: read-only measurement provenance (P3-UX-01) — uncertainty,
    // acquisition method, and original entry, shown alongside the annotation
    // details form's editable value/unit fields.
    case mapAnnotationAcquisitionMethodLabel = "map.annotation.acquisitionMethodLabel"
    case mapAnnotationUncertaintyLabel = "map.annotation.uncertaintyLabel"
    case mapAnnotationOriginalEntryLabel = "map.annotation.originalEntryLabel"
    case mapAcquisitionMethodUserEntered = "map.acquisitionMethod.userEntered"
    case mapAcquisitionMethodDerivedFromGeometry = "map.acquisitionMethod.derivedFromGeometry"
    case mapAcquisitionMethodArMeasurement = "map.acquisitionMethod.arMeasurement"
    case mapAcquisitionMethodImageExtraction = "map.acquisitionMethod.imageExtraction"
    case mapAcquisitionMethodDepthCapture = "map.acquisitionMethod.depthCapture"
    case mapAcquisitionMethodImportedPlan = "map.acquisitionMethod.importedPlan"

    // Map editor: server-reported validation warnings summary (P3-UX-01).
    // The issue `code` itself is not listed here — see
    // `MapValidationPresentation`'s doc comment for why it resolves the same
    // way `GeometryValidationCode`'s codes already do.
    case mapWarningsButtonTitle = "map.warnings.buttonTitle"
    case mapWarningsTitle = "map.warnings.title"
    case mapWarningsClose = "map.warnings.close"
    case mapValidationSeverityError = "map.validation.severity.error"
    case mapValidationSeverityWarning = "map.validation.severity.warning"

    // Map editor: non-survey disclosure (P3-UX-01).
    case mapDisclosureNonSurvey = "map.disclosure.nonSurvey"
    case mapDisclosureDismiss = "map.disclosure.dismiss"

    // Map editor: persistent save-status indicator (P3-UX-01) — richer than
    // `errorMessage`'s one-shot display, see `MapSaveStatus`.
    case mapSaveStatusSaving = "map.saveStatus.saving"
    case mapSaveStatusSavedLocally = "map.saveStatus.savedLocally"
    case mapSaveStatusSaved = "map.saveStatus.saved"
    case mapSaveStatusFailed = "map.saveStatus.failed"
    case mapErrorLocalCommandFailed = "map.error.localCommandFailed"

    // Plants: entry point (add/open), taxonomy search, and detail screen
    // (P4-IOS-01).
    case plantsTitle = "plants.title"
    case plantsClose = "plants.close"
    case plantsDisplayNameLabel = "plants.displayNameLabel"
    case plantsDisplayNameRequired = "plants.displayNameRequired"
    case plantsGroupingKindLabel = "plants.groupingKindLabel"
    case plantsGroupingKindIndividual = "plants.groupingKind.individual"
    case plantsGroupingKindRow = "plants.groupingKind.row"
    case plantsGroupingKindGroup = "plants.groupingKind.group"
    case plantsQuantityLabel = "plants.quantityLabel"
    case plantsQuantityRequired = "plants.quantityRequired"
    case plantsQuantityMustBePositive = "plants.quantityMustBePositive"
    case plantsVarietyLabelLabel = "plants.varietyLabelLabel"
    case plantsAcquisitionDateToggle = "plants.acquisitionDateToggle"
    case plantsAcquisitionDateLabel = "plants.acquisitionDateLabel"
    case plantsAcquisitionDateTypeLabel = "plants.acquisitionDateTypeLabel"
    case plantsAcquisitionDateTypePlanted = "plants.acquisitionDateType.planted"
    case plantsAcquisitionDateTypeSown = "plants.acquisitionDateType.sown"
    case plantsAcquisitionDateTypeAcquired = "plants.acquisitionDateType.acquired"
    case plantsTaxonomyLabel = "plants.taxonomyLabel"
    case plantsTaxonomyNone = "plants.taxonomyNone"
    case plantsTaxonomyClear = "plants.taxonomyClear"
    /// Fallback for the detail screen's identification summary when an
    /// existing plant's `taxonomyReferenceId` cannot be resolved to a
    /// friendly name — there is no `GET` for a single taxonomy reference,
    /// only `SearchTaxonomyReferences`. See `PlantDetailViewModel
    /// .selectedTaxonomyReferenceDisplay`'s doc comment.
    case plantsTaxonomyIdentifiedId = "plants.taxonomyIdentifiedId"
    case plantsGardenAreaLabel = "plants.gardenAreaLabel"
    case plantsPlacementLabel = "plants.placementLabel"
    case plantsMapObjectIdHint = "plants.mapObjectIdHint"
    case plantsAddSectionTitle = "plants.add.sectionTitle"
    case plantsAddSubmit = "plants.add.submit"
    case plantsOpenSectionTitle = "plants.open.sectionTitle"
    case plantsOpenIdLabel = "plants.open.idLabel"
    case plantsOpenSubmit = "plants.open.submit"
    case plantsOpenHint = "plants.open.hint"
    case plantsTaxonomyPickerTitle = "plants.taxonomyPicker.title"
    case plantsTaxonomyPickerSearchLabel = "plants.taxonomyPicker.searchLabel"
    case plantsTaxonomyPickerEmpty = "plants.taxonomyPicker.empty"
    case plantsLifecycleStagePlanned = "plants.lifecycleStage.planned"
    case plantsLifecycleStageSeed = "plants.lifecycleStage.seed"
    case plantsLifecycleStageSeedling = "plants.lifecycleStage.seedling"
    case plantsLifecycleStageTransplanted = "plants.lifecycleStage.transplanted"
    case plantsLifecycleStageGrowing = "plants.lifecycleStage.growing"
    case plantsLifecycleStageFlowering = "plants.lifecycleStage.flowering"
    case plantsLifecycleStageFruiting = "plants.lifecycleStage.fruiting"
    case plantsLifecycleStageReadyToHarvest = "plants.lifecycleStage.readyToHarvest"
    case plantsStatusActive = "plants.status.active"
    case plantsStatusDormant = "plants.status.dormant"
    case plantsStatusArchived = "plants.status.archived"
    case plantsStatusRemoved = "plants.status.removed"
    case plantsStatusDead = "plants.status.dead"
    case plantsDetailTitle = "plants.detail.title"
    case plantsDetailLoading = "plants.detail.loading"
    case plantsDetailRetry = "plants.detail.retry"
    case plantsDetailEditSectionTitle = "plants.detail.editSectionTitle"
    case plantsDetailConditionNoteLabel = "plants.detail.conditionNoteLabel"
    case plantsDetailCareGuidanceNoteLabel = "plants.detail.careGuidanceNoteLabel"
    case plantsDetailSave = "plants.detail.save"
    case plantsDetailLifecycleStageLabel = "plants.detail.lifecycleStageLabel"
    case plantsDetailStatusLabel = "plants.detail.statusLabel"
    case plantsDetailDeleteAction = "plants.detail.deleteAction"
    case plantsDetailMoveSectionTitle = "plants.detail.moveSectionTitle"
    case plantsDetailMoveSubmit = "plants.detail.moveSubmit"
    /// Persistent "saved locally, waiting to sync" signal for the detail
    /// screen (P5-IOS-02, Stage 4c) — the exact same copy Stage 4a used for
    /// Gardens and Stage 4b used for Map.
    case plantsSavedLocally = "plants.status.savedLocally"

    // Observations: timeline, record form, and correction sheet (P4-IOS-01).
    case observationsTitle = "observations.title"
    case observationsLoading = "observations.loading"
    case observationsRetry = "observations.retry"
    case observationsEmpty = "observations.empty"
    case observationsFilterLabel = "observations.filter.label"
    case observationsFilterApply = "observations.filter.apply"
    case observationsFilterClear = "observations.filter.clear"
    case observationsRecordSectionTitle = "observations.record.sectionTitle"
    case observationsNoteTextLabel = "observations.noteTextLabel"
    case observationsConditionSummaryLabel = "observations.conditionSummaryLabel"
    case observationsPlantIdLabel = "observations.plantIdLabel"
    case observationsGardenObjectIdLabel = "observations.gardenObjectIdLabel"
    case observationsMapObjectIdHint = "observations.mapObjectIdHint"
    case observationsObservedAtToggle = "observations.observedAtToggle"
    case observationsObservedAtLabel = "observations.observedAtLabel"
    case observationsRecordSubmit = "observations.record.submit"
    case observationsRecordRequiresContent = "observations.record.requiresContent"
    /// Shown when the record form's submit action is blocked because a
    /// picked photo has not finished uploading yet (`isPhotoBlockingSubmit`).
    case observationsRecordPhotoNotReady = "observations.record.photoNotReady"
    case observationsCorrectedBadge = "observations.correctedBadge"
    /// Shown on a row this device recorded or corrected purely offline this
    /// session and has not yet confirmed synced — the observation-timeline
    /// counterpart to `gardensSavedLocally`/`plantsSavedLocally`/
    /// `mapSaveStatusSavedLocally`.
    case observationsSavedLocally = "observations.status.savedLocally"
    case observationsCorrectAction = "observations.correctAction"
    case observationsAnalysisDisclaimer = "observations.analysisDisclaimer"
    case observationsAdditionalEvidenceRequested = "observations.additionalEvidenceRequested"
    case observationsCorrectionSheetTitle = "observations.correction.sheetTitle"
    case observationsCorrectionKindLabel = "observations.correction.kindLabel"
    case observationsCorrectionKindAmendment = "observations.correctionKind.amendment"
    case observationsCorrectionKindSupersede = "observations.correctionKind.supersede"
    case observationsCorrectionSubmit = "observations.correction.submit"
    case observationsClose = "observations.close"
    case observationsAnalysisKindStress = "observations.analysisKind.stress"
    case observationsAnalysisKindDisease = "observations.analysisKind.disease"
    case observationsAnalysisKindPest = "observations.analysisKind.pest"
    case observationsAnalysisKindOther = "observations.analysisKind.other"
    /// A correction row's own label: names the observation it corrects, the
    /// same way `apps/web/features/observations/observation-entry.tsx`
    /// renders `"{kind} of observation {id}"`.
    case observationsCorrectionOf = "observations.correctionOf"

    // Tasks: list, filter, create form, and per-task actions (P4-IOS-01).
    case tasksTitle = "tasks.title"
    case tasksLoading = "tasks.loading"
    case tasksRetry = "tasks.retry"
    case tasksEmpty = "tasks.empty"
    case tasksFilterLabel = "tasks.filter.label"
    case tasksFilterAll = "tasks.filter.all"
    case tasksCreateSectionTitle = "tasks.create.sectionTitle"
    case tasksTitleFieldLabel = "tasks.titleFieldLabel"
    case tasksNotesLabel = "tasks.notesLabel"
    case tasksTargetKindLabel = "tasks.targetKindLabel"
    case tasksTargetKindGarden = "tasks.targetKind.garden"
    case tasksTargetKindGardenArea = "tasks.targetKind.gardenArea"
    case tasksTargetKindPlant = "tasks.targetKind.plant"
    case tasksTargetGardenAreaLabel = "tasks.targetGardenAreaLabel"
    case tasksTargetPlantLabel = "tasks.targetPlantLabel"
    case tasksTargetIdRequired = "tasks.targetIdRequired"
    case tasksMapObjectIdHint = "tasks.mapObjectIdHint"
    case tasksDueDateToggle = "tasks.dueDateToggle"
    case tasksDueDateLabel = "tasks.dueDateLabel"
    case tasksTimeWindowToggle = "tasks.timeWindowToggle"
    case tasksTimeWindowStartLabel = "tasks.timeWindowStartLabel"
    case tasksTimeWindowEndLabel = "tasks.timeWindowEndLabel"
    case tasksUrgencyLabel = "tasks.urgencyLabel"
    case tasksUrgencyLow = "tasks.urgency.low"
    case tasksUrgencyNormal = "tasks.urgency.normal"
    case tasksUrgencyHigh = "tasks.urgency.high"
    case tasksUrgencyUrgent = "tasks.urgency.urgent"
    case tasksCreateSubmit = "tasks.create.submit"
    case tasksTitleRequired = "tasks.titleRequired"
    case tasksActionsTitle = "tasks.actionsTitle"
    case tasksEditAction = "tasks.editAction"
    case tasksRescheduleAction = "tasks.rescheduleAction"
    case tasksCompleteAction = "tasks.completeAction"
    case tasksSkipAction = "tasks.skipAction"
    case tasksDismissAction = "tasks.dismissAction"
    case tasksDeleteAction = "tasks.deleteAction"
    case tasksCancel = "tasks.cancel"
    case tasksClose = "tasks.close"
    case tasksStatusPlanned = "tasks.status.planned"
    case tasksStatusSuggested = "tasks.status.suggested"
    case tasksStatusCompleted = "tasks.status.completed"
    case tasksStatusSkipped = "tasks.status.skipped"
    case tasksStatusDismissed = "tasks.status.dismissed"
    case tasksStatusDeleted = "tasks.status.deleted"
    case tasksSavedLocally = "tasks.status.savedLocally"

    // Sync conflicts: durable-conflict list and compare/resolve sheet
    // (P5-CONFLICT-01).
    case syncConflictsTitle = "syncConflicts.title"
    case syncConflictsEmpty = "syncConflicts.empty"
    case syncConflictsConflictCodeLabel = "syncConflicts.conflictCodeLabel"
    case syncConflictsLocalLabel = "syncConflicts.localLabel"
    case syncConflictsServerLabel = "syncConflicts.serverLabel"
    case syncConflictsClose = "syncConflicts.close"
    case syncConflictsFailed = "syncConflicts.failed"
    case syncConflictsActionKeepServer = "syncConflicts.action.keepServer"
    case syncConflictsActionReapply = "syncConflicts.action.reapply"
    case syncConflictsActionDuplicate = "syncConflicts.action.duplicate"
    case syncConflictsActionReview = "syncConflicts.action.review"

    // Media attachment (P6-IOS-01): shared copy for the "Attach Photo"
    // affordance both `FeaturePlants.PlantDetailView` and
    // `FeatureObservations.ObservationsTimelineView` use, rendered through
    // `CoreMediaTransfer.PhotoAttachmentStatusLocalization` so both features
    // read identically rather than each writing its own copy.
    case mediaAttachSectionTitle = "media.attach.sectionTitle"
    case mediaAttachPickButton = "media.attach.pickButton"
    case mediaAttachRetryButton = "media.attach.retryButton"
    case mediaAttachRemoveButton = "media.attach.removeButton"
    case mediaStatusPreparing = "media.status.preparing"
    case mediaStatusWaitingForConnectivity = "media.status.waitingForConnectivity"
    case mediaStatusUploadingPercent = "media.status.uploadingPercent"
    case mediaStatusVerifying = "media.status.verifying"
    case mediaStatusProcessing = "media.status.processing"
    case mediaStatusReady = "media.status.ready"
    case mediaStatusRejected = "media.status.rejected"
    case mediaStatusFailed = "media.status.failed"

    // Property-plan document upload (P6-PLAN iOS parity) —
    // `FeatureGardens.GardenPlanUploadView`.
    case gardensOpenPlanUpload = "gardens.openPlanUpload"
    case mediaPlanTitle = "media.plan.title"
    case mediaPlanDescription = "media.plan.description"
    case mediaPlanSelectImage = "media.plan.selectImage"
    case mediaPlanSelectDocument = "media.plan.selectDocument"
    case mediaPlanUnsupportedType = "media.plan.unsupportedType"
    case mediaPlanTooLarge = "media.plan.tooLarge"
    case mediaPlanReadFailed = "media.plan.readFailed"
    case mediaPlanPdfNoPreview = "media.plan.pdfNoPreview"
    case mediaPlanPreviewLoading = "media.plan.previewLoading"
    case mediaPlanPreviewUnavailable = "media.plan.previewUnavailable"
    case mediaPlanReadyForMap = "media.plan.readyForMap"
    case mediaPlanStatusReady = "media.plan.statusReady"

    // Map editor: imported plan backgrounds (P6-PLAN iOS parity) — the
    // background panel, the canvas badge, and the per-background persisted
    // visibility control. Wording mirrors the web catalogue's same-named
    // `map.background.*` keys so the two clients state calibration
    // quality identically.
    case mapBackgroundPanelButton = "map.background.panelButton"
    case mapBackgroundTitle = "map.background.title"
    case mapBackgroundClose = "map.background.close"
    case mapBackgroundOnMapTitle = "map.background.onMapTitle"
    case mapBackgroundNoneOnMap = "map.background.noneOnMap"
    case mapBackgroundPlansTitle = "map.background.plansTitle"
    case mapBackgroundPlansLoading = "map.background.plansLoading"
    case mapBackgroundNoPlans = "map.background.noPlans"
    case mapBackgroundAddToMap = "map.background.addToMap"
    case mapBackgroundPageNumber = "map.background.pageNumber"
    case mapBackgroundPdfNoPreview = "map.background.pdfNoPreview"
    case mapBackgroundNotCalibrated = "map.background.notCalibrated"
    case mapBackgroundCalibrationStateLabel = "map.background.calibrationStateLabel"
    case mapBackgroundCalibratedError = "map.background.calibratedError"
    case mapBackgroundCalibratedNoEstimate = "map.background.calibratedNoEstimate"
    case mapBackgroundShow = "map.background.show"
    case mapBackgroundHide = "map.background.hide"
    case mapBackgroundRemove = "map.background.remove"
    case mapBackgroundRemoveConfirm = "map.background.removeConfirm"
    case mapBackgroundUnnamed = "map.background.unnamed"
    case mapBackgroundOpacity = "map.background.opacity"
    case mapBackgroundImageLoading = "map.background.imageLoading"
    case mapBackgroundImageUnavailable = "map.background.imageUnavailable"
    case mapBackgroundLockedByCalibration = "map.background.lockedByCalibration"

    // Measurement units, as their own entries rather than literals appended
    // to a formatted number: the abbreviation is a translated word, and the
    // decimal separator inside `{value}` is the reader's, not POSIX's.
    case mapUnitsCentimetres = "map.units.centimetres"
    case mapUnitsMetres = "map.units.metres"

    // Map editor: plan-background calibration (P6-PLAN-02 iOS parity) —
    // the calibration session bar. Step instructions say "Tap", the touch
    // counterpart of the web catalogue's "Click"; everything else mirrors
    // the web's `map.calibration.*` wording.
    case mapCalibrationTitle = "map.calibration.title"
    case mapCalibrationStart = "map.calibration.start"
    case mapCalibrationRestart = "map.calibration.restart"
    case mapCalibrationCancel = "map.calibration.cancel"
    case mapCalibrationApply = "map.calibration.apply"
    case mapCalibrationStepSegment = "map.calibration.stepSegment"
    case mapCalibrationStepDistance = "map.calibration.stepDistance"
    case mapCalibrationStepControlPlan = "map.calibration.stepControlPlan"
    case mapCalibrationStepControlLocal = "map.calibration.stepControlLocal"
    case mapCalibrationStepReady = "map.calibration.stepReady"
    case mapCalibrationDistanceLabel = "map.calibration.distanceLabel"
    case mapCalibrationRotationLabel = "map.calibration.rotationLabel"
    case mapCalibrationAddControlPoint = "map.calibration.addControlPoint"
    case mapCalibrationRepickSegment = "map.calibration.repickSegment"
    case mapCalibrationRemovePoint = "map.calibration.removePoint"
    case mapCalibrationControlPointsTitle = "map.calibration.controlPointsTitle"
    case mapCalibrationNoControlPoints = "map.calibration.noControlPoints"
    case mapCalibrationPointResidual = "map.calibration.pointResidual"
    case mapCalibrationRms = "map.calibration.rms"
    case mapCalibrationRmsUnavailable = "map.calibration.rmsUnavailable"
    case mapCalibrationScaleSummary = "map.calibration.scaleSummary"
    case mapCalibrationTransformRevision = "map.calibration.transformRevision"
    case mapCalibrationInvalidInput = "map.calibration.invalidInput"
    case mapCalibrationRequiresConnection = "map.calibration.requiresConnection"

    // The Today recommendation surface (P7-IOS-01). Keys are grouped by the
    // stage that introduced them, which is why `gardens.openToday` sits here
    // rather than with the earlier `gardens.open*` block.
    case gardensOpenToday = "gardens.openToday"
    case todayTitle = "today.title"
    case todayLoading = "today.loading"
    case todayRetry = "today.retry"
    case todayEmpty = "today.empty"
    case todayOffline = "today.offline"
    case todayStale = "today.stale"
    case todayConflict = "today.conflict"
    case todayTargetGarden = "today.target.garden"
    case todayPriorityScore = "today.priorityScore"
    case todayWindowRange = "today.window.range"
    case todayWindowUntil = "today.window.until"
    case todayWindowFrom = "today.window.from"
    case todaySafetyOrdinaryCare = "today.safety.ordinaryCare"
    case todaySafetyElevatedRisk = "today.safety.elevatedRisk"
    case todayDetailReasonTitle = "today.detail.reasonTitle"
    case todayDetailPriorityTitle = "today.detail.priorityTitle"
    case todayDetailEvidenceTitle = "today.detail.evidenceTitle"
    case todayDetailControlsTitle = "today.detail.controlsTitle"
    case todayDetailGone = "today.detail.gone"
    case todayActionComplete = "today.action.complete"
    case todayActionPostpone = "today.action.postpone"
    case todayActionDismiss = "today.action.dismiss"
    case todayActionMarkIrrelevant = "today.action.markIrrelevant"
    case todayActionConvert = "today.action.convert"
    case todayPostponeUntilToggle = "today.postpone.untilToggle"
    case todayPostponeUntilLabel = "today.postpone.untilLabel"
    case todayPostponeNoDateFootnote = "today.postpone.noDateFootnote"
    case todayPostponeSubmit = "today.postpone.submit"
    case todayCancel = "today.cancel"
    case todayConvertedMessage = "today.converted.message"
    case todayConvertedOpenTasks = "today.converted.openTasks"
    case todayIrrelevantRecorded = "today.irrelevantRecorded"
    case todayFactorUrgencyWindow = "today.factor.urgencyWindow"
    case todayFactorPlantImpact = "today.factor.plantImpact"
    case todayFactorConfidence = "today.factor.confidence"
    case todayFactorWeatherOpportunityOrRisk = "today.factor.weatherOpportunityOrRisk"
    case todayFactorUserEffortAndAvailability = "today.factor.userEffortAndAvailability"
    case todayFactorTaskOverlap = "today.factor.taskOverlap"
    case todayFactorSafetyConstraint = "today.factor.safetyConstraint"
    case todayFactorSeasonalConstraint = "today.factor.seasonalConstraint"
    case todayEvidencePlantIdentity = "today.evidence.plantIdentity"
    case todayEvidenceGardenContext = "today.evidence.gardenContext"
    case todayEvidenceWeather = "today.evidence.weather"
    case todayEvidenceSoilMoisture = "today.evidence.soilMoisture"
    case todayEvidenceObservation = "today.evidence.observation"
    case todayEvidenceTask = "today.evidence.task"
    case todayEvidenceLifecycleStage = "today.evidence.lifecycleStage"
    case todayEvidenceGeometryExposure = "today.evidence.geometryExposure"
    case todayEvidenceUserPreference = "today.evidence.userPreference"

    // The tab shell (P8-UX-01): the primary surfaces became tabs.
    case shellTabToday = "shell.tab.today"
    case shellTabTasks = "shell.tab.tasks"
    case shellTabPlants = "shell.tab.plants"
    case shellTabJournal = "shell.tab.journal"
    case shellTabMap = "shell.tab.map"
    case shellGardenMenu = "shell.garden.menu"
    case shellSwitchGarden = "shell.garden.switch"
    case gardensOpen = "gardens.open"
    case gardensNew = "gardens.new"
    case gardensCreateCancel = "gardens.create.cancel"
    case tasksFilterOpen = "tasks.filter.open"
    case tasksCreateOpen = "tasks.create.open"
    case observationsRecordOpen = "observations.record.open"
    case plantsAddOpen = "plants.add.open"
}
