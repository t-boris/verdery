import CoreDomain
import CoreLocalization
import Foundation

/// Display names and pure rendering rules for the Seasonal plan screen —
/// kept separate from the view model the same way `TodayLocalization` is
/// kept separate from `TodayViewModel`.
///
/// This codebase has no existing month-name utility (checked `CoreDomain`'s
/// `CalendarDate.swift`, which only round-trips the `yyyy-MM-dd` string
/// format, and `FeatureRecommendations.TodayLocalization`, which formats
/// full date-times, never a bare month) — `DateFormatter.standaloneMonthSymbols`
/// is Foundation's own locale-aware source for a month's nominative name, so
/// month numbers never reach a view as raw `1`-`12` integers.
public enum SeasonalPlanLocalization {
    /// Time-only formatting for the stale-set notice, the same
    /// `TodayLocalization.formattedTime` shape (the fetched-at time is today
    /// by construction — this is an in-memory, this-session result).
    static func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }

    /// Not a stored `static let`: `DateFormatter` is not `Sendable` — the
    /// same reason `TodayLocalization.formattedDateTime` computes its
    /// formatter fresh.
    static func monthName(_ month: Int) -> String {
        guard (1...12).contains(month) else { return String(month) }

        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        let symbols = formatter.standaloneMonthSymbols ?? formatter.monthSymbols ?? []
        guard symbols.count == 12 else { return String(month) }
        return symbols[month - 1]
    }

    /// Renders one start/end month pair as the range text when both bounds
    /// are set, the single-month text when only one is (an asymmetric
    /// configuration the schema allows but a reviewed fact is not expected
    /// to produce in practice), or `nil` when neither is set — never a
    /// fabricated window.
    static func monthWindow(startMonth: Int?, endMonth: Int?, strings: LocalizedStrings) -> String? {
        switch (startMonth, endMonth) {
        case (nil, nil):
            return nil
        case let (start?, end?):
            return strings.string(
                .seasonalPlanCalendarMonthRange,
                parameters: ["start": monthName(start), "end": monthName(end)]
            )
        case let (start?, nil):
            return strings.string(.seasonalPlanCalendarSingleMonth, parameters: ["month": monthName(start)])
        case let (nil, end?):
            return strings.string(.seasonalPlanCalendarSingleMonth, parameters: ["month": monthName(end)])
        }
    }

    /// Every configured window on a reviewed seasonal fact, as rows ready to
    /// render — the raw `1`-`12` integers `SeasonalPlanTaxonomyTiming`
    /// carries are never handed to the view; only the resolved month name
    /// is. Omits a window entirely when both its bounds are `nil`, so a
    /// plant with only, say, a harvest window shows exactly that one row.
    static func windowLines(_ timing: SeasonalPlanTaxonomyTiming, strings: LocalizedStrings) -> [SeasonalWindowLine] {
        let candidates: [(id: String, label: String, start: Int?, end: Int?)] = [
            ("sowIndoors", strings(.seasonalPlanCalendarSowIndoorsLabel), timing.sowIndoorsStartMonth, timing.sowIndoorsEndMonth),
            ("sowOutdoors", strings(.seasonalPlanCalendarSowOutdoorsLabel), timing.sowOutdoorsStartMonth, timing.sowOutdoorsEndMonth),
            ("transplant", strings(.seasonalPlanCalendarTransplantLabel), timing.transplantStartMonth, timing.transplantEndMonth),
            ("harvest", strings(.seasonalPlanCalendarHarvestLabel), timing.harvestStartMonth, timing.harvestEndMonth),
        ]

        return candidates.compactMap { id, label, start, end in
            guard let rangeText = monthWindow(startMonth: start, endMonth: end, strings: strings) else { return nil }
            return SeasonalWindowLine(id: id, label: label, rangeText: rangeText)
        }
    }

    /// Classifies one `SeasonalPlanRotationStatusEntry` into the exact
    /// sentence that describes it — never a generic "no conflict" catch-all,
    /// so a reader looking at the non-alarmed list can still see WHY each
    /// bed is fine (no prior occupant on record, a different family, no
    /// configured rest period, an unknown departure date, or a rest period
    /// that has already elapsed). Mirrors
    /// `apps/web/features/seasonal-plan/labels.ts`'s `describeRotationEntry`
    /// exactly, including its own trusted reading of the contract's
    /// `withinRestPeriod` guarantee (true only when `priorFamily` matches, a
    /// threshold is configured, and `elapsedDays` is below it) rather than
    /// re-deriving it — the `?? 0`/`?? ""` fallbacks in that branch are
    /// unreachable in practice, kept only so a malformed response degrades
    /// to a placeholder instead of throwing.
    static func describeRotationEntry(_ entry: SeasonalPlanRotationStatusEntry, strings: LocalizedStrings) -> String {
        if entry.withinRestPeriod {
            return strings.string(
                .seasonalPlanRotationConflictText,
                parameters: [
                    "family": entry.family,
                    "priorFamily": entry.priorFamily ?? "",
                    "elapsedDays": String(entry.elapsedDays ?? 0),
                    "restPeriodThresholdDays": String(entry.restPeriodThresholdDays ?? 0),
                ]
            )
        }

        guard let priorFamily = entry.priorFamily else {
            return strings.string(.seasonalPlanRotationNoPriorOccupant, parameters: ["family": entry.family])
        }

        if priorFamily != entry.family {
            return strings.string(
                .seasonalPlanRotationDifferentFamily,
                parameters: ["family": entry.family, "priorFamily": priorFamily]
            )
        }

        guard let elapsedDays = entry.elapsedDays else {
            return strings.string(
                .seasonalPlanRotationRestDurationUnknown,
                parameters: ["family": entry.family, "priorFamily": priorFamily]
            )
        }

        guard let thresholdDays = entry.restPeriodThresholdDays else {
            return strings.string(
                .seasonalPlanRotationNoRestPeriodConfigured,
                parameters: ["family": entry.family, "priorFamily": priorFamily, "elapsedDays": String(elapsedDays)]
            )
        }

        return strings.string(
            .seasonalPlanRotationRestPeriodElapsed,
            parameters: [
                "family": entry.family,
                "priorFamily": priorFamily,
                "elapsedDays": String(elapsedDays),
                "restPeriodThresholdDays": String(thresholdDays),
            ]
        )
    }
}
