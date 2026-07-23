import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureMap

/// Proves `MapSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalMapStore.confirmSynced(objectId:revision:)` with the right
/// parameter mapping (`recordId` → `objectId`), through a real
/// `InMemoryMapStore` — the same "fake/in-memory local store proving the
/// right store method gets called" coverage this work package calls for.
@Suite("Map sync record applier")
struct MapSyncRecordApplierTests {
    @Test("recordType is 'gardenObject', matching the contract's SyncRecordType")
    func recordTypeIsGardenObject() {
        let applier = MapSyncRecordApplier(localStore: InMemoryMapStore())
        #expect(applier.recordType == "gardenObject")
    }

    @Test("applyConfirmed advances the object's revision through the local store, keeping its geometry")
    func applyConfirmedAdvancesRevision() async throws {
        let store = InMemoryMapStore()
        let pending = GardenMapObject(
            id: "obj-1", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 1, y: 2)),
            coordinateSpaceId: "space-1", label: "Old Oak", categoryDetails: nil, lifecycleState: .active,
            revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            ([pending], OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.createObject",
                commandVersion: 1, targetRecordIds: ["obj-1"], expectedRevision: nil,
                payload: #"{"recordType":"gardenObject"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let applier = MapSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "obj-1", revision: 4, confirmedAt: Date())

        let confirmed = try #require(await store.fetchAll(gardenId: "garden-1").first)
        #expect(confirmed.revision == 4)
        #expect(confirmed.label == "Old Oak")
    }

    @Test("applyUpsert writes a genuinely new object pulled from another device")
    func applyUpsertWritesGenuinelyNewObject() async throws {
        let store = InMemoryMapStore()
        let applier = MapSyncRecordApplier(localStore: store)
        let pulled = GardenMapObject(
            id: "obj-2", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 3, y: 4)),
            coordinateSpaceId: "space-1", label: "New Maple", categoryDetails: nil, lifecycleState: .active,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )

        try await applier.applyUpsert(.gardenObject(pulled))

        let stored = try await store.fetchAll(gardenId: "garden-1").first { $0.id == "obj-2" }
        #expect(stored?.label == "New Maple")
    }

    @Test("applyDelete removes a real tombstone pulled from another device")
    func applyDeleteRemovesObject() async throws {
        let store = InMemoryMapStore()
        try await store.save(GardenMapObject(
            id: "obj-1", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 1, y: 2)),
            coordinateSpaceId: "space-1", label: "Old Oak", categoryDetails: nil, lifecycleState: .active,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        ))
        let applier = MapSyncRecordApplier(localStore: store)

        try await applier.applyDelete(recordId: "obj-1", gardenId: "garden-1", revision: 2)

        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
    }

    @Test("removeGardenScopedData removes every object for the garden, even with a pending offline mutation queued, and leaves other gardens untouched")
    func removeGardenScopedDataRemovesEveryObjectUnconditionally() async throws {
        let store = InMemoryMapStore()
        try await store.save(GardenMapObject(
            id: "obj-confirmed", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1", label: nil, categoryDetails: nil, lifecycleState: .active,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        ))
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            let pending = GardenMapObject(
                id: "obj-pending", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 1, y: 1)),
                coordinateSpaceId: "space-1", label: nil, categoryDetails: nil, lifecycleState: .active,
                revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
            )
            return ([pending], OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.createObject",
                commandVersion: 1, targetRecordIds: ["obj-pending"], expectedRevision: nil,
                payload: #"{"recordType":"gardenObject"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        try await store.save(GardenMapObject(
            id: "obj-other-garden", gardenId: "garden-2", category: .tree, geometry: .point(Position(x: 2, y: 2)),
            coordinateSpaceId: "space-1", label: nil, categoryDetails: nil, lifecycleState: .active,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        ))
        let applier = MapSyncRecordApplier(localStore: store)

        try await applier.removeGardenScopedData(gardenId: "garden-1")

        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await store.fetchAll(gardenId: "garden-2").map(\.id) == ["obj-other-garden"])
    }

    @Test("reapplyDraft replaces only expectedRevision, keeping the rest of the original local intent")
    func reapplyDraftReplacesOnlyExpectedRevision() throws {
        let applier = MapSyncRecordApplier(localStore: InMemoryMapStore())
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.moveObject",
            commandVersion: 1, targetRecordIds: ["obj-1"], expectedRevision: 3,
            payload: #"{"recordType":"gardenObject","gardenId":"garden-1","command":{"type":"moveObject","objectId":"obj-1","expectedRevision":3,"translationMetres":{"dx":1,"dy":2}}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let draft = try applier.reapplyDraft(original: original, newExpectedRevision: 8)

        #expect(draft.expectedRevision == 8)
        #expect(draft.payload.contains(#""expectedRevision":8"#))
        #expect(draft.payload.contains(#""dx":1"#))
    }

    @Test("reapplyDraft throws MapCommandError.conflictResolutionPayloadMalformed for a create command with no expectedRevision")
    func reapplyDraftThrowsForMalformedPayload() {
        let applier = MapSyncRecordApplier(localStore: InMemoryMapStore())
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.createObject",
            commandVersion: 1, targetRecordIds: ["obj-1"], expectedRevision: nil,
            payload: #"{"recordType":"gardenObject","gardenId":"garden-1","command":{"type":"createObject","objectId":"obj-1"}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        #expect(throws: MapCommandError.conflictResolutionPayloadMalformed) {
            try applier.reapplyDraft(original: original, newExpectedRevision: 8)
        }
    }

    @Test("duplicateDraft clones this device's own current local row as a new createObject command")
    func duplicateDraftClonesCurrentLocalRow() async throws {
        let store = InMemoryMapStore()
        try await store.save(GardenMapObject(
            id: "obj-1", gardenId: "garden-1", category: .tree, geometry: .point(Position(x: 5, y: 6)),
            coordinateSpaceId: "space-1", label: "Old Oak", categoryDetails: nil, lifecycleState: .active,
            revision: 4, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        ))
        let applier = MapSyncRecordApplier(localStore: store)
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.moveObject",
            commandVersion: 1, targetRecordIds: ["obj-1"], expectedRevision: 4,
            payload: #"{"recordType":"gardenObject","gardenId":"garden-1","command":{"type":"moveObject","objectId":"obj-1","expectedRevision":4,"translationMetres":{"dx":1,"dy":1}}}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let draft = try #require(try await applier.duplicateDraft(original: original, newRecordId: "obj-new"))

        #expect(draft.commandType == "map.createObject")
        #expect(draft.expectedRevision == nil)
        #expect(draft.targetRecordIds == ["obj-new"])
        #expect(draft.payload.contains(#""objectId":"obj-new""#))
        #expect(draft.payload.contains(#""label":"Old Oak""#))
    }

    @Test("duplicateDraft returns nil for a multi-target original operation (splitLinework/joinLinework)")
    func duplicateDraftReturnsNilForMultiTargetOperation() async throws {
        let store = InMemoryMapStore()
        let applier = MapSyncRecordApplier(localStore: store)
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.splitLinework",
            commandVersion: 1, targetRecordIds: ["obj-1", "obj-2", "obj-3"], expectedRevision: 2,
            payload: #"{"recordType":"gardenObject"}"#, createdAt: Date(timeIntervalSince1970: 0)
        )

        let draft = try await applier.duplicateDraft(original: original, newRecordId: "obj-new")

        #expect(draft == nil)
    }

    @Test("duplicateDraft returns nil when this device no longer has a local row for the object")
    func duplicateDraftReturnsNilWhenNoLocalRow() async throws {
        let applier = MapSyncRecordApplier(localStore: InMemoryMapStore())
        let original = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "map.moveObject",
            commandVersion: 1, targetRecordIds: ["obj-missing"], expectedRevision: 2,
            payload: #"{"recordType":"gardenObject"}"#, createdAt: Date(timeIntervalSince1970: 0)
        )

        let draft = try await applier.duplicateDraft(original: original, newRecordId: "obj-new")

        #expect(draft == nil)
    }
}
