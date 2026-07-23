/// Local validation and precondition failures for an offline-capable map
/// command, applied by `MapCommandProjection.apply(_:to:gardenId:coordinateSpaceId:now:)`.
///
/// Source: architecture/offline-synchronization.md, section "6. Local
/// Mutation Transaction", step 2 ("Validate the command locally").
public enum MapCommandError: Error, Equatable, Sendable {
    /// The command's target object (or one of them, for `joinLinework`) has
    /// no local row — every entry point that can build one of these commands
    /// already requires the object to be present in `MapEditorViewModel
    /// .objectsById` first (the same "not reachable through the shipped UI
    /// today" situation `FeatureGardens.GardenCommandError.localRecordNotFound`
    /// documents), but `LocalMapStore.commitOfflineMutation` loads its own
    /// fresh copy from `garden_object` inside the transaction — see that
    /// method's doc comment for why — so this stays a real, tested failure
    /// mode for whenever the two diverge, rather than a force-unwrap.
    case objectNotFound(objectId: String)

    /// `splitLinework`/`joinLinework`/`editVertex` addressed a geometry shape
    /// or vertex/ring index that command cannot operate on — mirrors the
    /// backend's own index-bookkeeping checks
    /// (`services/api/.../domain/geometry-edit.ts`): a `LineString`-only
    /// command given a `Polygon`, or an out-of-range vertex/ring index.
    case invalidGeometryOperation

    /// `joinLinework` targeted two objects of different categories — mirrors
    /// the backend's own `map.join_linework.category_mismatch` check
    /// (`services/api/.../application/join-map-object-linework.ts`).
    case categoryMismatch

    /// `assignPlant` targeted an object whose category (or whose
    /// `categoryDetails`) is not `plant` — mirrors the backend's own
    /// `map.assign_plant.not_a_plant` check
    /// (`services/api/.../application/assign-plant-to-target.ts`).
    case notAPlant

    /// `upsertCalibration`/`decideProposal` reached the offline commit path.
    /// Neither has a real client UI producer yet (see
    /// `tasks/todo.md`'s "Deferred with reason") — this exists so a future
    /// caller fails loudly and explicitly instead of silently mis-projecting
    /// a command this store was never built to apply, not because either
    /// command is expected to reach here today.
    case unsupportedCommand

    /// The built payload could not be encoded to UTF-8 JSON text — mirrors
    /// `FeatureGardens.GardenCommandError.payloadEncodingFailed`'s identical
    /// reasoning for the same near-impossible failure mode.
    case payloadEncodingFailed
}
