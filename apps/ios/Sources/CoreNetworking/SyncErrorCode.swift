/// Stable `error.code` values `GET /sync/changes` can return that require a
/// full resynchronization, rather than an ordinary retry — architecture/
/// offline-synchronization.md, section "13. Full Resynchronization".
///
/// The raw values mirror `packages/api-contracts`'s own `SyncErrorCode`
/// exactly (`packages/api-contracts/src/index.ts`), the same "module-specific
/// codes live with their module" convention `SharedErrorCode`'s own doc
/// comment establishes for the request pipeline's shared codes. Distinct
/// from `CoreDomain.SyncErrorCategory` — that type classifies why an outbox
/// operation's *attempt* did not succeed (a persisted retry-bookkeeping
/// concept); this one names two specific, stable wire error codes.
public enum SyncErrorCode: String, Sendable {
    /// `after` is older than retained history — `GetSyncChanges`'s own doc
    /// comment (`services/api/src/modules/synchronization/application/
    /// get-sync-changes.ts`) names this one of two full-resync triggers.
    case cursorExpired = "sync.changes.cursor_expired"
    /// `protocolVersion` is outside the server's currently supported window.
    case protocolVersionUnsupported = "sync.protocol_version.unsupported"
}
