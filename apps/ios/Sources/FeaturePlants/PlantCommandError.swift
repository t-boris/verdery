/// Local validation and precondition failures for the five offline-capable
/// plant commands (`AddPlant`, `UpdatePlantDetails`,
/// `TransitionPlantLifecycleStage`, `SetPlantStatus`, `MovePlant`).
///
/// Source: architecture/offline-synchronization.md, section "6. Local
/// Mutation Transaction", step 2 ("Validate the command locally").
public enum PlantCommandError: Error, Equatable, Sendable {
    /// The display name is empty after trimming, or longer than the
    /// contract's 200-character limit (`packages/api-contracts/openapi.yaml`,
    /// `AddPlantRequest.displayName` / `UpdatePlantDetailsRequest.displayName`,
    /// `maxLength: 200`) — mirrors the backend's own
    /// `plants_inventory.plant.display_name.too_long`/`.blank` checks
    /// (`plants-inventory/domain/plant.ts`, `validateDisplayName`).
    case invalidDisplayName

    /// `UpdatePlantDetails`/`TransitionPlantLifecycleStage`/`SetPlantStatus`/
    /// `MovePlant` target a plant this device has no local read-model row for
    /// yet — step 1 of the local mutation transaction ("Load the current
    /// local record") found nothing to apply the command to.
    ///
    /// Not reachable through the shipped UI today: `PlantDetailViewModel
    /// .load()` always populates the local row — from cache or from
    /// `GetPlant` — before any mutation control is enabled, the same
    /// "not reachable, kept as a real tested failure mode rather than a
    /// force-unwrap" reasoning `FeatureGardens.GardenCommandError
    /// .localRecordNotFound`'s own doc comment gives.
    case localRecordNotFound

    /// The built payload could not be encoded to UTF-8 JSON text. Not
    /// expected to actually occur — `JSONEncoder`'s output is always valid
    /// UTF-8 — but `PlantSyncCommandPayload.encode` has no force-unwrap, so
    /// this exists as the alternative to one.
    case payloadEncodingFailed

    /// `PlantSyncRecordApplier.reapplyDraft` could not parse a retained
    /// outbox operation's own `payload` text, or that payload's `command`
    /// object carried no `expectedRevision` field to replace — mirrors
    /// `FeatureGardens.GardenCommandError.conflictResolutionPayloadMalformed`'s
    /// identical reasoning.
    case conflictResolutionPayloadMalformed
}
