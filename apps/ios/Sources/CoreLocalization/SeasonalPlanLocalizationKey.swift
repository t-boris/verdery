/// Keys the Seasonal plan screen (P9D-UX-01) resolves against the
/// localization catalogue: the Calendar sub-view (reviewed sow/transplant/
/// harvest windows, rendered as month names, never raw `1`-`12` integers),
/// the hemisphere-unknown empty state, and the Rotation sub-view (rest-period
/// conflicts in plain language, and the disclosed non-conflict entries).
///
/// A second enum rather than more cases in ``LocalizationKey``, for the same
/// structural reason ``ProfileLocalizationKey``'s own doc comment gives:
/// ``LocalizationKey`` sits at this repository's 600-line file-size ceiling,
/// so a new key set is the only way to add a key at all. See that type's doc
/// comment for why this is a file boundary, not a second source of truth —
/// both enums resolve through the same ``LocalizedStrings`` against the same
/// catalogue, and `Tests/CoreLocalizationTests` covers both together.
///
/// Wording mirrors `apps/web/features/seasonal-plan`'s own `seasonalPlan.*`
/// catalogue keys, per this package's own "mirror the INFORMATION content"
/// instruction — see that feature's `labels.ts`/`seasonal-calendar.tsx`/
/// `rotation-conflicts.tsx` for the identical decomposition this key set
/// follows.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
public enum SeasonalPlanLocalizationKey: String, Sendable, CaseIterable {
    case seasonalPlanTitle = "seasonalPlan.title"
    case seasonalPlanDescription = "seasonalPlan.description"
    case seasonalPlanTodayCardSubtitle = "seasonalPlan.todayCard.subtitle"
    case seasonalPlanLoading = "seasonalPlan.loading"
    case seasonalPlanRetry = "seasonalPlan.retry"
    case seasonalPlanOffline = "seasonalPlan.offline"
    /// `{time}` — the last-fetched set is kept on screen behind this notice
    /// when a refresh fails, mirroring `TodayViewModel.staleNoticeText`'s own
    /// "kept-but-labeled-stale" degraded state (`today.stale`).
    case seasonalPlanStale = "seasonalPlan.stale"
    /// `{plantId}` fallback label for a plant row — this screen deliberately
    /// shows the raw plant id rather than a resolved display name; see
    /// `SeasonalPlanViewModel`'s own doc comment for why.
    case seasonalPlanPlantFallback = "seasonalPlan.plantFallback"

    case seasonalPlanCalendarTitle = "seasonalPlan.calendar.title"
    case seasonalPlanCalendarEmpty = "seasonalPlan.calendar.empty"
    case seasonalPlanCalendarNoSeasonalData = "seasonalPlan.calendar.noSeasonalData"
    case seasonalPlanCalendarNoWindowsConfigured = "seasonalPlan.calendar.noWindowsConfigured"
    case seasonalPlanCalendarSowIndoorsLabel = "seasonalPlan.calendar.sowIndoorsLabel"
    case seasonalPlanCalendarSowOutdoorsLabel = "seasonalPlan.calendar.sowOutdoorsLabel"
    case seasonalPlanCalendarTransplantLabel = "seasonalPlan.calendar.transplantLabel"
    case seasonalPlanCalendarHarvestLabel = "seasonalPlan.calendar.harvestLabel"
    /// `{start}`/`{end}` month names.
    case seasonalPlanCalendarMonthRange = "seasonalPlan.calendar.monthRange"
    /// `{month}` name, for the asymmetric case where only one bound is set.
    case seasonalPlanCalendarSingleMonth = "seasonalPlan.calendar.singleMonth"

    case seasonalPlanHemisphereUnknownTitle = "seasonalPlan.hemisphereUnknownTitle"
    case seasonalPlanHemisphereUnknownDescription = "seasonalPlan.hemisphereUnknownDescription"
    case seasonalPlanHemisphereUnknownLink = "seasonalPlan.hemisphereUnknownLink"

    case seasonalPlanRotationTitle = "seasonalPlan.rotation.title"
    case seasonalPlanRotationConflictsEmpty = "seasonalPlan.rotation.conflictsEmpty"
    case seasonalPlanRotationConflictBadge = "seasonalPlan.rotation.conflictBadge"
    /// `{family}`, `{priorFamily}`, `{elapsedDays}`, `{restPeriodThresholdDays}`.
    case seasonalPlanRotationConflictText = "seasonalPlan.rotation.conflictText"
    /// `{family}`.
    case seasonalPlanRotationNoPriorOccupant = "seasonalPlan.rotation.noPriorOccupant"
    /// `{family}`, `{priorFamily}`.
    case seasonalPlanRotationDifferentFamily = "seasonalPlan.rotation.differentFamily"
    /// `{family}`, `{priorFamily}`.
    case seasonalPlanRotationRestDurationUnknown = "seasonalPlan.rotation.restDurationUnknown"
    /// `{family}`, `{priorFamily}`, `{elapsedDays}`.
    case seasonalPlanRotationNoRestPeriodConfigured = "seasonalPlan.rotation.noRestPeriodConfigured"
    /// `{family}`, `{priorFamily}`, `{elapsedDays}`, `{restPeriodThresholdDays}`.
    case seasonalPlanRotationRestPeriodElapsed = "seasonalPlan.rotation.restPeriodElapsed"
    case seasonalPlanRotationShowOthers = "seasonalPlan.rotation.showOthers"
    case seasonalPlanRotationHideOthers = "seasonalPlan.rotation.hideOthers"
}
