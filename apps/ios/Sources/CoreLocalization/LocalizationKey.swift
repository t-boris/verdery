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
    case mapSaveStatusSaved = "map.saveStatus.saved"
    case mapSaveStatusFailed = "map.saveStatus.failed"
}
