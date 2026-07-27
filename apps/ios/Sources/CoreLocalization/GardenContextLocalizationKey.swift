/// Keys the Context quality screen (P9D-UX-01) resolves against the
/// localization catalogue: one row per `GardenContextKind`, its declared
/// value and source, and the edit form for the four fixed-vocabulary kinds.
///
/// A second enum rather than more cases in ``LocalizationKey``, for the same
/// structural reason ``ProfileLocalizationKey``'s own doc comment gives —
/// ``LocalizationKey`` sits at this repository's 600-line file-size ceiling.
/// See that type's doc comment for why this is a file boundary, not a second
/// source of truth.
///
/// Wording mirrors `apps/web/features/garden-context`'s own `contextQuality.*`
/// catalogue keys, per this package's own "mirror the INFORMATION content"
/// instruction — see that feature's `labels.ts`/`context-fact-row.tsx`/
/// `context-fact-edit-form.tsx` for the identical vocabulary this key set
/// follows.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `GardenContext`.
public enum GardenContextLocalizationKey: String, Sendable, CaseIterable {
    case contextQualityTitle = "contextQuality.title"
    case contextQualityDescription = "contextQuality.description"
    /// The `navigationCard` title `GardenSettingsView` uses to reach this
    /// screen — kept in this key set rather than `LocalizationKey`'s own
    /// `gardens.open*` block, which is already at the file's 600-line cap.
    case contextQualityOpenTitle = "contextQuality.openTitle"
    case contextQualityLoading = "contextQuality.loading"
    case contextQualityRetry = "contextQuality.retry"
    case contextQualityOffline = "contextQuality.offline"
    case contextQualityDeclare = "contextQuality.declare"
    case contextQualityEdit = "contextQuality.edit"
    case contextQualityNotDeclared = "contextQuality.notDeclared"
    case contextQualityValueLabel = "contextQuality.valueLabel"
    case contextQualityValueRequired = "contextQuality.valueRequired"
    case contextQualitySave = "contextQuality.save"
    case contextQualityCancelEdit = "contextQuality.cancelEdit"
    /// `{profileId}` — the raw profile id, this codebase's own established
    /// fallback (`tasks.assignedToDisplay`'s convention): there is no
    /// member-display-name field anywhere in this API.
    case contextQualityRecordedByDisplay = "contextQuality.recordedByDisplay"
    /// `{reviewedBy}`, `{reviewedOn}`.
    case contextQualityReviewedByDisplay = "contextQuality.reviewedByDisplay"

    case contextQualityKindSunExposure = "contextQuality.kind.sunExposure"
    case contextQualityKindSoilType = "contextQuality.kind.soilType"
    case contextQualityKindDrainage = "contextQuality.kind.drainage"
    case contextQualityKindIrrigationMethod = "contextQuality.kind.irrigationMethod"
    case contextQualityKindGrowingContext = "contextQuality.kind.growingContext"
    case contextQualityKindMicroclimate = "contextQuality.kind.microclimate"

    case contextQualitySourceUserDeclared = "contextQuality.source.userDeclared"
    case contextQualitySourceHorticulturallyReviewedDefault = "contextQuality.source.horticulturallyReviewedDefault"
    case contextQualitySourceImported = "contextQuality.source.imported"

    case contextQualityEnumSunExposureFullSun = "contextQuality.enum.sunExposure.fullSun"
    case contextQualityEnumSunExposurePartialSun = "contextQuality.enum.sunExposure.partialSun"
    case contextQualityEnumSunExposurePartialShade = "contextQuality.enum.sunExposure.partialShade"
    case contextQualityEnumSunExposureFullShade = "contextQuality.enum.sunExposure.fullShade"

    case contextQualityEnumDrainageWellDrained = "contextQuality.enum.drainage.wellDrained"
    case contextQualityEnumDrainagePoorDrainage = "contextQuality.enum.drainage.poorDrainage"
    case contextQualityEnumDrainageWaterlogged = "contextQuality.enum.drainage.waterlogged"

    case contextQualityEnumIrrigationMethodManual = "contextQuality.enum.irrigationMethod.manual"
    case contextQualityEnumIrrigationMethodDrip = "contextQuality.enum.irrigationMethod.drip"
    case contextQualityEnumIrrigationMethodSprinkler = "contextQuality.enum.irrigationMethod.sprinkler"
    case contextQualityEnumIrrigationMethodNone = "contextQuality.enum.irrigationMethod.none"

    case contextQualityEnumGrowingContextOpenGround = "contextQuality.enum.growingContext.openGround"
    case contextQualityEnumGrowingContextContainer = "contextQuality.enum.growingContext.container"
    case contextQualityEnumGrowingContextGreenhouse = "contextQuality.enum.growingContext.greenhouse"
}
