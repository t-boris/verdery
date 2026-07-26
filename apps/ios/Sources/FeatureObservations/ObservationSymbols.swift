import CoreDesignSystem

/// Which SF Symbol stands for each kind of journal entry and each of its
/// states.
enum ObservationSymbols {
    /// What kind of entry this is, at a glance: a correction of an earlier
    /// entry, an entry carrying photo analysis, or a plain note.
    static func entry(_ row: ObservationRow) -> String {
        if row.correctionKindLabel != nil { return "arrow.triangle.branch" }
        if !row.analysisSummaries.isEmpty { return "camera.viewfinder" }
        return "text.bubble.fill"
    }

    static let observedAt = "clock"
    static let corrected = "pencil.and.outline"
    static let correct = "square.and.pencil"
    static let analysis = "sparkle.magnifyingglass"
    static let pendingSync = "arrow.triangle.2.circlepath"
    static let photo = "photo"
}
