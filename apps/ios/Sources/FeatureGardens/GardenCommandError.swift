/// Local validation and precondition failures for the offline-capable
/// garden commands (`CreateGarden`, `RenameGarden`, `ArchiveGarden`,
/// `RequestGardenDeletion`).
///
/// Source: architecture/offline-synchronization.md, section "6. Local
/// Mutation Transaction", step 2 ("Validate the command locally").
public enum GardenCommandError: Error, Equatable, Sendable {
    /// The name is empty after trimming, or longer than the contract's
    /// 120-character limit (`packages/api-contracts/openapi.yaml`,
    /// `CreateGardenRequest.name` / `RenameGardenRequest.name`,
    /// `maxLength: 120`).
    case invalidName

    /// `RenameGarden`/`ArchiveGarden`/`RequestGardenDeletion` target a garden
    /// this device has no local read-model row for yet — step 1 of the local
    /// mutation transaction ("Load the current local record") found nothing
    /// to apply the command to.
    ///
    /// Not reachable through the shipped UI today: every screen that can
    /// invoke these commands loads the record first
    /// (`GardenSettingsViewModel.load()`), which always populates the local
    /// row — from cache or from `GetGarden` — before any mutation control is
    /// enabled. Kept as a real, tested failure mode rather than a
    /// precondition/force-unwrap because the store-level contract
    /// (`LocalGardenStore.commitOfflineMutation`) is reusable by future call
    /// sites this view model does not control.
    case localRecordNotFound

    /// The built payload could not be encoded to UTF-8 JSON text. Not
    /// expected to actually occur — `JSONEncoder`'s output is always valid
    /// UTF-8 — but `GardenSyncCommandPayload.encode` has no force-unwrap, so
    /// this exists as the alternative to one.
    case payloadEncodingFailed

    /// `GardenSyncRecordApplier.reapplyDraft` could not parse a retained
    /// outbox operation's own `payload` text, or that payload's `command`
    /// object carried no `expectedRevision` field to replace — a
    /// defense-in-depth backstop (`SyncConflictReplayableApplier
    /// .reapplyDraft`'s own doc comment) against `RemoteSyncEngine` calling
    /// this for a command `ConflictRecoveryPolicy.isSafelyReplayable`
    /// already excluded; not expected to actually occur.
    case conflictResolutionPayloadMalformed
}
