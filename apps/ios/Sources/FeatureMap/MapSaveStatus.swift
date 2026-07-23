/// Persistent presentation of the map editor's most recent command outcome —
/// richer than the raw `MapEditorViewModel.isSubmitting` boolean, which says
/// only "is a request in flight right now" and forgets everything the
/// instant it flips back to `false`.
///
/// This app is online-first with no offline command queue
/// (`MapEditorViewModel`'s own doc comment; "Native Offline Synchronization
/// and Web Continuity" is a separate, future Phase 5 work package that would
/// add one) — so there is no "local, not yet synchronized" state to
/// represent here. `.saving` is the only in-flight case; every command
/// either lands as `.saved` or the whole attempt is `.failed`, matching the
/// always-fresh-from-server design this view model already commits to.
public enum MapSaveStatus: Equatable, Sendable {
    /// Nothing pending. The initial state, and where a fresh `.saved`/`.failed`
    /// stays until the next command starts — this pass never demotes either
    /// one back to `.idle` on a timer; see `MapEditorViewModel.saveStatus`'s
    /// doc comment.
    case idle
    /// A command is in flight.
    case saving
    /// The most recently submitted command was confirmed by the server.
    case saved
    /// The most recently submitted command was rejected or could not reach
    /// the server. Persists — unlike `MapEditorViewModel.errorMessage`,
    /// which a fresh submission attempt clears immediately — until the next
    /// command actually succeeds, so a "not saved" state is never missed by
    /// only glancing away for a moment.
    case failed
}
