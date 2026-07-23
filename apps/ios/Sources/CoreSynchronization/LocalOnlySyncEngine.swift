import CoreDomain
import CorePersistence

/// A `SyncEngine` that only touches local storage — no network calls.
///
/// This work package builds no push/pull protocol implementation (see
/// `SyncEngine`'s doc comment); this type exists so `CorePersistence`'s
/// local storage has a realistic, testable seam to run against before a
/// real network-backed engine exists. `pushPending()` reads pending
/// operations to confirm the local seam works but submits nothing.
/// `pullChanges()` is a genuine no-op: it neither reads nor advances any
/// cursor, since a real implementation would need `CoreNetworking` (not a
/// dependency of this target — see this package's `Package.swift`) to know
/// what to pull.
public actor LocalOnlySyncEngine: SyncEngine {
    private let outboxStore: any SyncOutboxStore

    public init(outboxStore: any SyncOutboxStore) {
        self.outboxStore = outboxStore
    }

    public func pushPending() async throws {
        _ = try await outboxStore.fetchAll()
    }

    public func pullChanges() async throws {
        // No network in this stage. A real engine implements this against
        // CoreNetworking and CorePersistence.SyncCursorStore once a later
        // stage adds the push/pull protocol itself.
    }
}
