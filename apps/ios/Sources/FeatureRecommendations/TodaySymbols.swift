import CoreDesignSystem
import CoreDomain

/// Which SF Symbol and tone stand for each urgency and safety tier on the
/// Today surface.
///
/// `FeatureTasks` keeps its own copy of the urgency table rather than sharing
/// one: features never depend on each other, and `CoreDesignSystem`
/// deliberately knows nothing about the domain, so the alternative would be
/// pushing a presentation decision down into `CoreDomain`. Eight lines
/// repeated once is the cheaper of the two prices, and the two tables are
/// checked against each other by reading, not by inheritance — they describe
/// the same `TaskUrgency`, so they are kept identical on purpose.
enum TodaySymbols {
    static func urgency(_ urgency: TaskUrgency) -> String {
        switch urgency {
        case .low: "tortoise.fill"
        case .normal: "circle.fill"
        case .high: "exclamationmark.2"
        case .urgent: "flame.fill"
        }
    }

    static func urgencyTone(_ urgency: TaskUrgency) -> Tone {
        switch urgency {
        case .low: .neutral
        case .normal: .info
        case .high: .warning
        case .urgent: .negative
        }
    }

    /// The care category is an open vocabulary the server does not enumerate,
    /// so the symbol is matched on the few stems that actually occur and falls
    /// back to a neutral marker for anything else — never to a wrong icon.
    static func careCategory(_ category: String) -> String {
        let lowercased = category.lowercased()
        if lowercased.contains("water") || lowercased.contains("irrig") { return "drop.fill" }
        if lowercased.contains("prune") || lowercased.contains("trim") { return "scissors" }
        if lowercased.contains("feed") || lowercased.contains("fertil") { return "bolt.fill" }
        if lowercased.contains("harvest") { return "basket.fill" }
        if lowercased.contains("pest") || lowercased.contains("disease") { return "ant.fill" }
        if lowercased.contains("plant") || lowercased.contains("sow") { return "leaf.fill" }
        if lowercased.contains("protect") || lowercased.contains("frost") { return "shield.fill" }
        return "circle.grid.2x2.fill"
    }

    static let elevatedRisk = "exclamationmark.shield.fill"
    static let window = "clock.fill"
    static let uncertainty = "questionmark.circle.fill"
    static let priority = "chart.bar.fill"
    static let target = "scope"
}
