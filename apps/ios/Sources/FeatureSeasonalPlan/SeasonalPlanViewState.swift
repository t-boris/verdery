import CoreDomain

/// One configured window on a Calendar row, already localized — a label
/// ("Sow indoors") and the resolved month-name range under it.
public struct SeasonalWindowLine: Equatable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let rangeText: String
}

/// One plant's Calendar row, already localized.
///
/// `plantLabel` is `seasonalPlan.plantFallback` (`"Plant: {plantId}"`) — see
/// `SeasonalPlanViewModel`'s own doc comment for why this screen shows the
/// raw plant id rather than a resolved display name.
public struct SeasonalCalendarRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let plantLabel: String
    /// `true` for `noSeasonalData` — the row still renders, only
    /// de-emphasized, never hidden.
    public let isDeemphasized: Bool
    public let windowLines: [SeasonalWindowLine]
    /// Set when there is no row content to show for this plant:
    /// `seasonalPlan.calendar.noSeasonalData` when `isDeemphasized`,
    /// `seasonalPlan.calendar.noWindowsConfigured` for a reviewed fact with
    /// every window null. `nil` whenever `windowLines` is non-empty.
    public let noteText: String?
}

/// One placed plant's rotation status row, already localized — the same
/// classified sentence `describeRotationEntry` (`SeasonalPlanLocalization
/// .swift`) produces for every one of `SeasonalPlanRotationStatusEntry`'s
/// possible shapes, never a generic catch-all.
public struct RotationStatusRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let plantLabel: String
    public let descriptionText: String
    /// Mirrors `SeasonalPlanRotationStatusEntry.withinRestPeriod` — only
    /// used by the caller to decide which section (conflicts vs. disclosed
    /// others) a row belongs in; the row itself carries no styling.
    public let isConflict: Bool
}

/// The Seasonal plan screen's loaded content, already localized and split
/// exactly the way the two sub-views render it.
public struct SeasonalPlanPresentation: Equatable, Sendable {
    /// `false` exactly when `SeasonalPlanResult.hemisphere` was `nil` — the
    /// Calendar sub-view's own hemisphere-unknown empty state, scoped to
    /// that sub-view only (Rotation's `family`/`priorFamily` do not depend
    /// on hemisphere, so it keeps rendering regardless).
    public let hemisphereKnown: Bool
    public let calendarRows: [SeasonalCalendarRow]
    /// `SeasonalPlanRotationStatusEntry.withinRestPeriod == true` — shown
    /// prominently.
    public let rotationConflicts: [RotationStatusRow]
    /// `withinRestPeriod == false` — available behind a disclosure, never
    /// alarmed over.
    public let rotationOthers: [RotationStatusRow]
}

/// Immutable display state for the Seasonal plan screen.
///
/// The same shape `TodayViewState` establishes (`.loading`/`.loaded`/
/// `.offline`/`.failed`), per this package's own "do not invent a new state
/// machine shape" instruction. `.offline` is a distinct, named state rather
/// than a generic failure — the Seasonal plan surface is online-only by
/// documented decision (see `SeasonalPlanUseCases.swift`), so "needs a
/// connection" is a truthful description of the surface, not an error the
/// user caused.
public enum SeasonalPlanViewState: Equatable, Sendable {
    case loading
    case loaded(SeasonalPlanPresentation)
    case offline
    case failed(message: String)
}
