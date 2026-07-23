import CoreDomain

/// Immutable display state for the sync conflicts screen — one per garden,
/// matching `CorePersistence.SyncConflictStore.fetchOpen(gardenId:)`'s own
/// scoping.
public enum SyncConflictsViewState: Equatable, Sendable {
    case loading
    /// Every open conflict for this garden, oldest first — the exact order
    /// `SyncConflictStore.fetchOpen(gardenId:)` already returns.
    case loaded([SyncConflict])
    case failed(message: String)
}
