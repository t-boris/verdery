import CoreDomain

/// `OutboxOperation`, `SyncCursor`, `SyncConflict`, `SyncOperationResult`,
/// `ConflictRecoveryAction`, and `MediaTransfer` live in `CoreDomain`, not in
/// this target, even though this work package's brief describes them as
/// "the plain Swift domain types `CoreSynchronization` exposes publicly."
/// They cannot live here: `CorePersistence`'s repositories (`SyncOutboxStore`
/// and the rest) construct and return exactly these types, and
/// `CorePersistence` does not — and, per this package's `Package.swift`,
/// must not — depend on `CoreSynchronization` (the dependency runs the other
/// way: this target depends on `CorePersistence`, not vice versa). Declaring
/// them in `CoreDomain` instead is the same resolution this codebase already
/// uses for `AuthTokenProvider` (declared in `CoreDomain`, implemented by
/// `CoreAuthentication`, consumed by `CoreNetworking` — neither of which may
/// depend on the other): a type two non-hierarchically-related layers both
/// need belongs one level below both, not inside either. This target
/// re-exports nothing; it only adds `SyncEngine` and its local-only
/// implementation on top of what `CoreDomain` and `CorePersistence` already
/// expose.
///
/// The seam a push/pull synchronization engine implements.
///
/// This work package (P5-IOS-01) was local-storage-only: no network calls,
/// no real push/pull protocol implementation. `RemoteSyncEngine`
/// (P5-IOS-03, Stage 5a) is that real implementation for `pushPending()` —
/// see its own doc comment; `pullChanges()` stays a no-op on every
/// conformer, including `RemoteSyncEngine`, until Stage 5b builds the pull
/// side against `GET /sync/changes` (architecture/offline-synchronization.md,
/// section "10. Pull Protocol"). This protocol exists so:
///
/// - Every stage after P5-IOS-01 has a stable type to build a real,
///   network-backed implementation against, without every call site
///   changing — `RemoteSyncEngine` is proof this worked: nothing outside
///   `CoreSynchronization`/`AppCompositionRoot` had to change to adopt it.
/// - `LocalOnlySyncEngine` still lets a caller exercise `CorePersistence`'s
///   local storage through a realistic shape with no network dependency at
///   all — a preview, or a test that only cares about the local seam.
///
/// Source: architecture/ios-application-design.md, section
/// "8. Synchronization Integration" ("The synchronization engine is a
/// long-lived application service ... It performs bounded push and pull
/// cycles").
public protocol SyncEngine: Sendable {
    /// Submits every pending outbox operation, across every garden — the
    /// push request is profile-scoped, not per-garden (section "8. Push
    /// Protocol": "The request identifies the client installation, profile,
    /// protocol version, and operations") — and applies their outcomes.
    func pushPending() async throws

    /// Pulls and applies changes for every garden partition with a local
    /// cursor. Unlike push, the pull request itself is per-garden-partition
    /// (section "10. Pull Protocol"); an implementation loops its own
    /// known partitions internally rather than exposing that loop here.
    func pullChanges() async throws
}
