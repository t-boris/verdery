import Foundation

#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// Asks iOS for occasional time to drain the outbox while the app is closed.
///
/// The third trigger `architecture/ios-application-design.md` section 8 names,
/// and the last one this codebase was missing. Without it, work recorded in a
/// garden reaches the server only when the app is next opened; with it, the
/// system hands the app a few seconds when the device is idle and charging
/// enough, and the walk is uploaded before anyone opens anything.
///
/// A *processing* task rather than an app-refresh one: draining an outbox and
/// pulling changes can take longer than the few seconds refresh allows, and
/// this work has no deadline — it is better done well when convenient than
/// hurried every hour.
///
/// The scheduler is best-effort by design. iOS decides whether and when to run
/// this, and may never do so on a device that is rarely charged; every state
/// it would have advanced is still advanced by foregrounding or by
/// reconnection, so nothing depends on it.
@MainActor
public final class BackgroundSyncScheduler {
    /// Also declared in `project.yml` under `BGTaskSchedulerPermittedIdentifiers`.
    /// iOS refuses to register a task whose identifier is not listed there,
    /// and the failure is a trap at launch rather than a returned error.
    public static let taskIdentifier = "com.verdery.app.sync"

    /// Roughly a quarter of a day. The earliest the system MAY run it, not a
    /// schedule: asking for sooner does not make it happen sooner, and asking
    /// for often gets an app deprioritised.
    private static let earliestDelay: TimeInterval = 6 * 60 * 60

    private let synchronize: @MainActor @Sendable () async -> Void
    private var isRegistered = false

    public init(synchronize: @escaping @MainActor @Sendable () async -> Void) {
        self.synchronize = synchronize
    }

    /// Must be called before the application finishes launching — iOS rejects
    /// a later registration.
    public func register() {
        #if canImport(BackgroundTasks) && os(iOS)
        guard !isRegistered else { return }
        isRegistered = true

        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.taskIdentifier,
            using: nil
        ) { task in
            MainActor.assumeIsolated {
                self.run(task)
            }
        }
        #endif
    }

    /// Asks for the next opportunity. Safe to call repeatedly; a duplicate
    /// submission replaces the pending request rather than queueing a second.
    public func scheduleNext() {
        #if canImport(BackgroundTasks) && os(iOS)
        let request = BGProcessingTaskRequest(identifier: Self.taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Self.earliestDelay)
        // Neither is required: a bounded push and pull is not expensive, and
        // demanding power or an unmetered connection would mostly mean never
        // running at all.
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
        #endif
    }

    #if canImport(BackgroundTasks) && os(iOS)
    private func run(_ task: BGTask) {
        // Re-armed FIRST: if the work below throws, is expired, or the process
        // is killed, the next opportunity has already been requested. A
        // scheduler that only re-arms on success stops forever after one bad
        // night.
        scheduleNext()

        let work = Task { @MainActor in
            await synchronize()
            task.setTaskCompleted(success: true)
        }

        // The system reclaims the time by calling this; the cycle checkpoints
        // after every accepted push result and every pulled page
        // (offline-synchronization.md section 19), so cancelling mid-flight
        // loses progress but never correctness.
        task.expirationHandler = {
            work.cancel()
            task.setTaskCompleted(success: false)
        }
    }
    #endif
}
