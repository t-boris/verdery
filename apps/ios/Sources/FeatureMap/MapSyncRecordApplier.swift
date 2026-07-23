import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation

/// `CoreSynchronization.SyncRecordApplier` for `recordType: "gardenObject"`
/// — registered with the real `SyncEngine` at composition-root time
/// (`AppCompositionRoot`, the one place allowed to import both
/// `CoreSynchronization` and every `Feature*` module).
///
/// Source: implementation-plan.md work package P5-IOS-03, Stages 5a
/// (`applyConfirmed`) and 5b (`SyncPullRecordApplier`); P5-CONFLICT-01,
/// Stage 6 (`SyncConflictReplayableApplier`, `SyncConflictDuplicatingApplier`
/// — the only record type that supports both).
public struct MapSyncRecordApplier: SyncRecordApplier, SyncPullRecordApplier, SyncConflictReplayableApplier, SyncConflictDuplicatingApplier {
    public let recordType = "gardenObject"

    private let localStore: any LocalMapStore

    public init(localStore: any LocalMapStore) {
        self.localStore = localStore
    }

    public func applyConfirmed(recordId: String, revision: Int, confirmedAt: Date) async throws {
        try await localStore.confirmSynced(objectId: recordId, revision: revision)
    }

    public func applyUpsert(_ snapshot: SyncChangeSnapshot) async throws {
        guard case let .gardenObject(object) = snapshot else { return }
        try await localStore.save(object)
    }

    /// Unlike `GardenSyncRecordApplier.applyDelete`, this is a real, ordinary
    /// tombstone — see `LocalMapStore.delete(objectId:)`'s own doc comment
    /// for why a `gardenObject` deletion needs no revocation-style scope
    /// carve-out: it is already produced by real, live server-side commands
    /// (`delete-map-object.ts`, `join`/`split-map-object-linework.ts`) with
    /// no ambiguity about what "delete this object" means.
    public func applyDelete(recordId: String, gardenId: String?, revision: Int) async throws {
        try await localStore.delete(objectId: recordId)
    }

    /// P5-SEC-01: removes every `garden_object` row this device has cached
    /// for `gardenId`, as part of `RemoteSyncEngine+Pull.swift`'s
    /// garden-partition cascade — see that method's own doc comment, and
    /// `CoreSynchronization.SyncRecordApplier
    /// .removeGardenScopedData(gardenId:)`'s own doc comment for the full
    /// contract.
    public func removeGardenScopedData(gardenId: String) async throws {
        try await localStore.removeAll(gardenId: gardenId)
    }

    /// See `SyncConflictReplayableApplier.reapplyDraft(original:newExpectedRevision:)`'s
    /// own doc comment, and `ConflictRecoveryPolicy`'s own table for exactly
    /// which `map.*` command types this is ever actually called for
    /// (`moveObject`/`replaceGeometry`/`changeProperties`/`assignPlant`/
    /// `deleteObject`/`restoreObject` — never `editVertex`/`splitLinework`/
    /// `joinLinework`, which stay structurally unsafe to replay verbatim).
    public func reapplyDraft(original: OutboxOperation, newExpectedRevision: Int) throws -> ConflictResolutionOperationDraft {
        let payload = try ConflictResolutionPayloadEditing.replacingExpectedRevision(
            in: original.payload,
            with: newExpectedRevision,
            orThrow: MapCommandError.conflictResolutionPayloadMalformed
        )
        return ConflictResolutionOperationDraft(
            commandType: original.commandType,
            commandVersion: original.commandVersion,
            targetRecordIds: original.targetRecordIds,
            expectedRevision: newExpectedRevision,
            payload: payload
        )
    }

    /// See `SyncConflictDuplicatingApplier.duplicateDraft(original:newRecordId:)`'s
    /// own doc comment: clones THIS DEVICE's own current `garden_object` row
    /// — already this device's best-known local projection, however it got
    /// there (a relative move, an absolute replace, a vertex edit, ...),
    /// never recomputed from `original`'s own command payload — as a new
    /// `createObject` command. `nil` when `original` names more than one
    /// target record (`splitLinework`/`joinLinework`, already excluded from
    /// offering this action at all — `ConflictRecoveryPolicy.isDuplicable`)
    /// or when this device no longer has a local row for it.
    public func duplicateDraft(original: OutboxOperation, newRecordId: String) async throws -> ConflictResolutionOperationDraft? {
        guard original.targetRecordIds.count == 1, let objectId = original.targetRecordIds.first else { return nil }

        let objects = try await localStore.fetchAll(gardenId: original.gardenId)
        guard let source = objects.first(where: { $0.id == objectId }) else { return nil }

        let createPayload = MapCommandPayload.createObject(
            CreateObjectPayload(
                objectId: newRecordId,
                category: source.category,
                geometry: source.geometry,
                label: source.label,
                categoryDetails: source.categoryDetails
            )
        )
        let payload = try GardenObjectSyncCommandPayload.encode(gardenId: original.gardenId, command: createPayload)

        return ConflictResolutionOperationDraft(
            commandType: "map.\(createPayload.type.rawValue)",
            commandVersion: GardenObjectSyncCommandPayload.version,
            targetRecordIds: [newRecordId],
            expectedRevision: nil,
            payload: payload
        )
    }
}
