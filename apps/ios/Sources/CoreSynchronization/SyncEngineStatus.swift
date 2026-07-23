import Foundation

/// A read-only summary of `RemoteSyncEngine`'s most recent push/pull
/// activity — architecture/ios-application-design.md, section
/// "8. Synchronization Integration": "exposes summary status through a
/// read-only observable interface."
///
/// Covers five of that section's six vocabulary terms. `Upload pending`
/// (media transfer, section "18. Media Coordination") is deliberately
/// absent: `CorePersistence.MediaTransferStore` exists but no media-upload
/// flow calls it yet anywhere in this codebase (confirmed by inspection —
/// see `FeatureObservations.ObservationsUseCases.swift`'s own doc comment),
/// so this stage has no real media state to report — the same honest
/// "not produced by any code path yet" placeholder
/// `FeatureMap.MapSaveStatus.saved`'s own doc comment already uses for an
/// analogous gap.
///
/// Per-feature UI (`FeatureMap.MapSaveStatus`, `FeaturePlants
/// .PlantDetailSummary.syncStatusLabel`, and their siblings in Gardens/
/// Observations/Tasks) is NOT wired to this type in this stage — a
/// deliberate scope call, not an oversight: those labels are session-scoped
/// to one screen's own local commits ("nil for a plant this session only
/// ever read"), while this status is engine-scoped across the whole
/// profile's outbox and change stream; reconciling the two shapes is a real
/// design question spanning five `Feature*` modules' view models, better
/// left to its own follow-up than half-wired here under this stage's
/// already-large scope. See this stage's own report for the fuller
/// reasoning.
public enum SyncEngineStatus: Equatable, Sendable {
    /// No push or pull cycle has run on this engine instance yet.
    case unknown
    /// A push or pull cycle is currently in flight.
    case synchronizing
    /// The most recent cycle finished with local mutations still queued
    /// (`sync_outbox` non-empty) but nothing durably failed.
    case savedLocally
    /// The most recent cycle finished with an empty outbox and no open
    /// failure.
    case synchronized
    /// The most recent attempt's failure classified as `.connectivity`
    /// (`CoreDomain.SyncErrorCategory`) — a transport-level failure, or a
    /// `Retry-After`-bearing `429`, automatic retry may resolve on its own.
    case waitingForConnectivity
    /// The most recent attempt failed in a way automatic retry cannot
    /// resolve on its own: authentication, authorization, or validation: a
    /// second consecutive pull `409` (`sync.changes.cursor_expired`/
    /// `sync.protocol_version.unsupported`); or an undecodable/unexpected
    /// response. Architecture/offline-synchronization.md, section
    /// "20. Connectivity and Backoff": "Authentication, authorization,
    /// validation, and conflict failures do not retry automatically as
    /// transient failures."
    case requiresAttention
}
