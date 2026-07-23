/// Local validation failures for the two offline-capable observation
/// commands (`RecordObservation`, `CorrectObservation`).
///
/// Deliberately has no `localRecordNotFound` case, unlike
/// `FeatureGardens.GardenCommandError`/`FeatureMap.MapCommandError`/
/// `FeaturePlants.PlantCommandError`: every one of those exists because its
/// feature's commands load a "current" local record that might be missing.
/// Neither observation command ever does — see `LocalObservationStore`'s own
/// doc comment for why an append-only aggregate has no such record to load —
/// so there is no "local record wasn't found" failure mode for this feature
/// to have.
///
/// Source: architecture/offline-synchronization.md, section "6. Local
/// Mutation Transaction", step 2 ("Validate the command locally").
public enum ObservationCommandError: Error, Equatable, Sendable {
    /// Neither a note nor a condition summary was supplied. Photos are
    /// always empty for a command this client builds (see
    /// `ObservationsUseCases.swift`'s own doc comment on why), so this is
    /// the only way the contract's "at least a note, a condition summary, or
    /// a photo" rule can be violated from this client —
    /// `RecordObservationRequest`/`CorrectObservationRequest`'s own
    /// description in `packages/api-contracts/openapi.yaml`, enforced
    /// server-side by `requireObservationContent`
    /// (`observations-history/domain/observation.ts`).
    case invalidContent

    /// The built payload could not be encoded to UTF-8 JSON text. Not
    /// expected to actually occur — `JSONEncoder`'s output is always valid
    /// UTF-8 — but `ObservationSyncCommandPayload.encode` has no
    /// force-unwrap, so this exists as the alternative to one.
    case payloadEncodingFailed
}
