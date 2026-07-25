import CoreDomain
import CoreLocalization
import Foundation

/// Display names for the recommendation domain's enums and the pure
/// rendering rules for the open-shaped stored facts — kept separate from the
/// view model the same way `ObservationsLocalization` is kept separate from
/// `ObservationsTimelineViewModel`.
///
/// The urgency and target-kind names resolve the SAME `tasks.*` catalogue
/// keys `FeatureTasks.TasksLocalization` uses (the vocabularies are shared
/// by contract design — `TaskUrgency`/`TaskTargetKind` are one glossary),
/// so a recommendation and the task it converts into read identically. The
/// key-mapping switch is repeated here because features cannot import each
/// other; the catalogue keys, and therefore the text, are the single shared
/// source.
public enum TodayLocalization {
    public static func key(for kind: RecommendationPriorityFactorKind) -> LocalizationKey {
        switch kind {
        case .urgencyWindow: .todayFactorUrgencyWindow
        case .plantImpact: .todayFactorPlantImpact
        case .confidence: .todayFactorConfidence
        case .weatherOpportunityOrRisk: .todayFactorWeatherOpportunityOrRisk
        case .userEffortAndAvailability: .todayFactorUserEffortAndAvailability
        case .taskOverlap: .todayFactorTaskOverlap
        case .safetyConstraint: .todayFactorSafetyConstraint
        case .seasonalConstraint: .todayFactorSeasonalConstraint
        }
    }

    public static func key(for kind: RecommendationEvidenceKind) -> LocalizationKey {
        switch kind {
        case .plantIdentity: .todayEvidencePlantIdentity
        case .gardenContext: .todayEvidenceGardenContext
        case .weather: .todayEvidenceWeather
        case .soilMoisture: .todayEvidenceSoilMoisture
        case .observation: .todayEvidenceObservation
        case .task: .todayEvidenceTask
        case .lifecycleStage: .todayEvidenceLifecycleStage
        case .geometryExposure: .todayEvidenceGeometryExposure
        case .userPreference: .todayEvidenceUserPreference
        }
    }

    public static func key(for tier: RecommendationSafetyTier) -> LocalizationKey {
        switch tier {
        case .ordinaryCare: .todaySafetyOrdinaryCare
        case .elevatedRisk: .todaySafetyElevatedRisk
        }
    }

    public static func urgencyName(_ urgency: TaskUrgency, strings: LocalizedStrings) -> String {
        switch urgency {
        case .low: strings(.tasksUrgencyLow)
        case .normal: strings(.tasksUrgencyNormal)
        case .high: strings(.tasksUrgencyHigh)
        case .urgent: strings(.tasksUrgencyUrgent)
        }
    }

    /// One factor as readable text: localized kind name, signed contribution,
    /// and the stored basis facts — FR-24's uncertainty (low confidence,
    /// stale-weather labels) surfaces here exactly as the engine stored it,
    /// never re-interpreted.
    public static func factorLine(_ factor: RecommendationPriorityFactor, strings: LocalizedStrings) -> String {
        let name = strings(key(for: factor.kind))
        let contribution = signedText(factor.contribution)
        let basis = basisText(factor.basis)
        return basis.isEmpty ? "\(name) \(contribution)" : "\(name) \(contribution) — \(basis)"
    }

    /// One evidence entry's fact as readable text. A `.null` `factValue`
    /// means the referenced row itself is the value (the contract's own
    /// description), so only the fact key is shown.
    public static func evidenceFactText(_ evidence: RecommendationEvidence) -> String {
        if case .null = evidence.factValue {
            return evidence.factKey
        }
        return "\(evidence.factKey): \(displayText(evidence.factValue))"
    }

    /// The stored open-shaped basis object as deterministic readable text:
    /// `key: value` pairs, key-sorted so the same facts always read the same.
    public static func basisText(_ basis: [String: JSONValue]) -> String {
        basis.keys.sorted()
            .map { key in "\(key): \(displayText(basis[key] ?? .null))" }
            .joined(separator: ", ")
    }

    /// Renders one stored JSON fact value as short readable text. Structure
    /// is preserved recursively; nothing is re-interpreted.
    public static func displayText(_ value: JSONValue) -> String {
        switch value {
        case .null:
            return "—"
        case let .bool(flag):
            return flag ? "true" : "false"
        case let .number(number):
            return numberText(number)
        case let .string(text):
            return text
        case let .array(items):
            return items.map(displayText).joined(separator: ", ")
        case let .object(fields):
            return fields.keys.sorted()
                .map { key in "\(key): \(displayText(fields[key] ?? .null))" }
                .joined(separator: ", ")
        }
    }

    /// The candidate's validity window as one readable line, `nil` when the
    /// candidate has no window at all.
    public static func windowText(start: Date?, end: Date?, strings: LocalizedStrings) -> String? {
        switch (start, end) {
        case (nil, nil):
            return nil
        case let (start?, end?):
            return strings.string(
                .todayWindowRange,
                parameters: ["start": formattedDateTime(start), "end": formattedDateTime(end)]
            )
        case let (nil, end?):
            return strings.string(.todayWindowUntil, parameters: ["end": formattedDateTime(end)])
        case let (start?, nil):
            return strings.string(.todayWindowFrom, parameters: ["start": formattedDateTime(start)])
        }
    }

    /// Not a stored `static let`: `DateFormatter` is not `Sendable` — the
    /// same reason `ObservationsLocalization.formattedObservedAt` computes
    /// its formatter fresh.
    public static func formattedDateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }

    /// Time-only variant for the stale-set notice, where the date is today
    /// by construction (an in-memory, this-session result).
    public static func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }

    private static func signedText(_ contribution: Int) -> String {
        contribution > 0 ? "+\(contribution)" : String(contribution)
    }

    /// Integral numbers render without a fraction; the rest keep up to three
    /// locale-formatted decimal places — the same precision ceiling
    /// `LocalizedStrings`'s own measurement formatting applies.
    private static func numberText(_ number: Double) -> String {
        if number == number.rounded(), abs(number) < 1e15 {
            return String(Int(number))
        }

        let formatter = NumberFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: number)) ?? String(number)
    }
}
