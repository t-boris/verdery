/// Persistent presentation of the map editor's most recent command outcome —
/// richer than the raw `MapEditorViewModel.isSubmitting` boolean, which says
/// only "is a request in flight right now" and forgets everything the
/// instant it flips back to `false`.
///
/// As of P5-IOS-02 (Stage 4b), every map command commits through
/// `MapEditorViewModel.applyMapCommandOffline` — one atomic local
/// transaction, no network call (`LocalMapStore.commitOfflineMutation`) — so
/// `.savedLocally`, not `.saved`, is what a successful command now settles
/// to. `.saved` stays declared, unused by any code path today, exactly the
/// same "left in place for a later stage" treatment
/// `FeatureGardens.GardenGateway` gets from Stage 4a: a real push/pull
/// `SyncEngine` (P5-IOS-03) is what will eventually confirm a command server-
/// side and produce `.saved` for real. Until then, claiming `.saved` for a
/// command that never left the device would be exactly the "fake
/// Synchronizing/Synchronized claim" this work package is scoped to avoid.
public enum MapSaveStatus: Equatable, Sendable {
    /// Nothing pending. The initial state, and where a fresh
    /// `.savedLocally`/`.saved`/`.failed` stays until the next command
    /// starts — this pass never demotes any of them back to `.idle` on a
    /// timer; see `MapEditorViewModel.saveStatus`'s doc comment.
    case idle
    /// A command is in flight.
    case saving
    /// The most recently submitted command committed to the local
    /// `garden_object` table and outbox — the honestly-scoped signal this
    /// stage can actually make: "saved on this device," not "synchronized."
    /// Mirrors `FeatureGardens`'s identical `gardens.status.savedLocally`
    /// string for the same event.
    case savedLocally
    /// The most recently submitted command was confirmed by the server. Not
    /// produced by any code path yet — see this type's own doc comment.
    case saved
    /// The most recently submitted command failed to commit locally.
    /// Persists — unlike `MapEditorViewModel.errorMessage`, which a fresh
    /// submission attempt clears immediately — until the next command
    /// actually succeeds, so a "not saved" state is never missed by only
    /// glancing away for a moment.
    case failed
}
