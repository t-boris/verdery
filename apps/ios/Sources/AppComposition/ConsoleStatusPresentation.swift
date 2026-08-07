import CoreDesignSystem
import CoreLocalization
import CoreSynchronization

/// Turns the synchronization engine's vocabulary into the sentence the console
/// strip shows.
///
/// A pure function, deliberately: this is the only part of the status surface
/// that can be verified without a simulator, so everything that constitutes a
/// *decision* — which engine state maps to which level, when a count is worth
/// showing, what a person is told — lives here rather than inside a view.
///
/// It sits in the composition layer because it is the one place allowed to
/// know both vocabularies: `CoreDesignSystem` depends on nothing and must not
/// learn about synchronization, and `CoreSynchronization` must not learn about
/// presentation.
///
/// Source: architecture/ios-application-design.md, section
/// "8. Synchronization Integration".
public enum ConsoleStatusPresentation {
    /// - Parameters:
    ///   - status: the engine's own most recent summary.
    ///   - pendingCount: operations still in the outbox.
    ///   - strings: the resolved catalogue, since `ConsoleStatus` carries text
    ///     rather than keys.
    public static func status(
        for status: SyncEngineStatus,
        pendingCount: Int,
        strings: LocalizedStrings
    ) -> ConsoleStatus {
        switch status {
        case .synchronized:
            return ConsoleStatus(label: strings(.syncStatusSynced), level: .settled)

        case .synchronizing:
            // No count while a cycle is in flight: the number is about to be
            // wrong, and a figure that ticks down and back up reads as a fault.
            return ConsoleStatus(label: strings(.syncStatusSyncing), level: .working)

        case .savedLocally:
            return ConsoleStatus(
                label: strings(.syncStatusSavedLocally), level: .pending, count: pendingCount
            )

        case .waitingForConnectivity:
            return ConsoleStatus(
                label: strings(.syncStatusOffline), level: .offline, count: pendingCount
            )

        case .requiresAttention:
            return ConsoleStatus(
                label: strings(.syncStatusRequiresAttention),
                level: .attention,
                count: pendingCount
            )

        case .unknown:
            // No cycle has run yet on this engine. If work is already queued,
            // saying so is more honest than a dash — the queue is a fact even
            // when the engine has no result to report about it.
            return pendingCount > 0
                ? ConsoleStatus(
                    label: strings(.syncStatusSavedLocally), level: .pending, count: pendingCount
                )
                : ConsoleStatus(label: strings(.syncStatusSynced), level: .settled)
        }
    }
}
