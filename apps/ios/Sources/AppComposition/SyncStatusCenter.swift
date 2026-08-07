import CoreDesignSystem
import CoreLocalization
import CorePersistence
import CoreSynchronization
import Foundation
import Observation

/// The application-lifetime owner of "is my work safe".
///
/// `RemoteSyncEngine.status` has always been computed and always been thrown
/// away: `RootView` minted a fresh engine on every foregrounding, ran one
/// cycle, and let the instance — and its status — go out of scope. That was a
/// deliberate trade, and `makeSyncEngine()`'s own doc comment explains why a
/// cached singleton would be wrong: an engine bound to whichever profile was
/// signed in at construction keeps operating against a stale database after a
/// sign-out and sign-in as somebody else.
///
/// This keeps the safety and gains the observability by binding to a *profile*
/// rather than to a moment: the engine is held only as long as the profile it
/// was built for is still the one signed in, and rebuilt the instant that
/// changes.
///
/// Source: architecture/ios-application-design.md, section
/// "8. Synchronization Integration" — the engine "exposes summary status
/// through a read-only observable interface".
@MainActor
@Observable
public final class SyncStatusCenter {
    public private(set) var status: SyncEngineStatus = .unknown
    public private(set) var pendingCount: Int = 0

    @ObservationIgnored private let makeEngine: @MainActor () -> RemoteSyncEngine
    @ObservationIgnored private let makeOutboxStore: @MainActor () -> any SyncOutboxStore
    @ObservationIgnored private let currentProfileIdentifier: @MainActor () -> String
    @ObservationIgnored private var boundProfileIdentifier: String?
    @ObservationIgnored private var engine: RemoteSyncEngine?

    public init(
        makeEngine: @escaping @MainActor () -> RemoteSyncEngine,
        makeOutboxStore: @escaping @MainActor () -> any SyncOutboxStore,
        currentProfileIdentifier: @escaping @MainActor () -> String
    ) {
        self.makeEngine = makeEngine
        self.makeOutboxStore = makeOutboxStore
        self.currentProfileIdentifier = currentProfileIdentifier
    }

    /// What the console strip should say right now.
    public func consoleStatus(strings: LocalizedStrings) -> ConsoleStatus {
        ConsoleStatusPresentation.status(for: status, pendingCount: pendingCount, strings: strings)
    }

    /// Runs one push/pull cycle and publishes what it found.
    ///
    /// Failures are absorbed rather than thrown: the strip reports the state
    /// the engine reached, which is the honest surface for a failure here, and
    /// there is no caller in a position to do anything else with the error.
    public func synchronize() async {
        let engine = boundEngine()
        status = .synchronizing
        try? await engine.retryNow()
        status = await engine.status
        await refreshPendingCount()
    }

    /// Called after a local write, so the strip flips to "on device" the
    /// moment a task is ticked rather than at the next cycle.
    ///
    /// It does not start a cycle. A person tapping through six edits should
    /// not queue six pushes; the next real trigger — foreground, connectivity,
    /// background opportunity — drains them together.
    public func noteLocalMutation() async {
        await refreshPendingCount()
        if pendingCount > 0, status == .synchronized || status == .unknown {
            status = .savedLocally
        }
    }

    private func refreshPendingCount() async {
        let store = makeOutboxStore()
        pendingCount = (try? await store.fetchAll().count) ?? pendingCount
    }

    /// The engine for whoever is signed in *now*, rebuilt if that changed.
    private func boundEngine() -> RemoteSyncEngine {
        let profile = currentProfileIdentifier()
        if let engine, boundProfileIdentifier == profile { return engine }

        // A different profile is a different database and a different outbox,
        // so nothing about the previous one is still true.
        status = .unknown
        pendingCount = 0
        let engine = makeEngine()
        self.engine = engine
        boundProfileIdentifier = profile
        return engine
    }
}
