import Foundation
import Network

/// Runs a synchronization cycle when the network comes back.
///
/// `architecture/ios-application-design.md` section 8 lists connectivity change
/// as one of the triggers the engine reacts to, and `RootScene` has carried a
/// comment admitting nothing observed it. Foregrounding was the only real
/// trigger, so work saved in a garden with no signal waited until the app was
/// backgrounded and opened again — which, for someone who finishes a walk and
/// pockets the phone, could be the next day.
///
/// Only the *transition* into reachability fires. A monitor that ran on every
/// path update would sync on each cell-to-Wi-Fi handover and each interface
/// flap, and `offline-synchronization.md` section 20 is explicit that
/// reachability is a hint rather than proof — so this is one nudge, and the
/// engine's own backoff owns what happens if the nudge was wrong.
@MainActor
public final class ConnectivityTrigger {
    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "com.verdery.app.connectivity")
    private var isStarted = false
    /// Starts optimistic: the first update on a device that is already online
    /// is a report, not a reconnection, and foregrounding has just synced.
    private var wasSatisfied = true

    public init() {
        monitor = NWPathMonitor()
    }

    public func start(onReconnect: @escaping @MainActor @Sendable () -> Void) {
        guard !isStarted else { return }
        isStarted = true

        monitor.pathUpdateHandler = { path in
            let isSatisfied = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                defer { self.wasSatisfied = isSatisfied }
                guard isSatisfied, !self.wasSatisfied else { return }
                onReconnect()
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}
