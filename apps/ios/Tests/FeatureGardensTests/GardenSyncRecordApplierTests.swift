import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureGardens

/// Proves `GardenSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalGardenStore.confirmSynced(gardenId:revision:)` with the right
/// parameter mapping (`recordId` → `gardenId`), through a real
/// `InMemoryGardenStore` rather than a hand-rolled spy — the same "fake/
/// in-memory local store proving the right store method gets called"
/// coverage this work package calls for.
@Suite("Garden sync record applier")
struct GardenSyncRecordApplierTests {
    @Test("recordType is 'garden', matching the contract's SyncRecordType")
    func recordTypeIsGarden() {
        let applier = GardenSyncRecordApplier(localStore: InMemoryGardenStore())
        #expect(applier.recordType == "garden")
    }

    @Test("applyConfirmed advances the garden's revision through the local store")
    func applyConfirmedAdvancesRevision() async throws {
        let store = InMemoryGardenStore()
        let pending = Garden(
            id: "garden-1", name: "Backyard", lifecycleState: .active, callerRole: .owner,
            revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (pending, OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "gardens.create",
                commandVersion: 1, targetRecordIds: ["garden-1"], expectedRevision: nil,
                payload: #"{"recordType":"garden"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let applier = GardenSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "garden-1", revision: 6, confirmedAt: Date())

        #expect(try await store.fetchAll().first?.revision == 6)
    }

    /// The "genuinely new (not this device's own) record gets correctly
    /// upserted locally" case P5-IOS-03, Stage 5b's own testing requirement
    /// names: this store never saw `garden-2` before at all — no prior
    /// `commitOfflineMutation`, no prior `save` — proving `applyUpsert`
    /// really does write a record pulled from another device/session, not
    /// merely confirm one this device already knew about.
    @Test("applyUpsert writes a genuinely new garden pulled from another device")
    func applyUpsertWritesGenuinelyNewGarden() async throws {
        let store = InMemoryGardenStore()
        let applier = GardenSyncRecordApplier(localStore: store)
        let pulled = Garden(
            id: "garden-2", name: "Front Yard", lifecycleState: .active, callerRole: .editor,
            revision: 3, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )

        try await applier.applyUpsert(.garden(pulled))

        let stored = try await store.fetchAll().first { $0.id == "garden-2" }
        #expect(stored?.name == "Front Yard")
        #expect(stored?.revision == 3)
    }

    @Test("applyUpsert does not clobber a pending local mutation for the same garden")
    func applyUpsertRespectsPendingGuard() async throws {
        let store = InMemoryGardenStore()
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (
                Garden(
                    id: "garden-1", name: "Local Edit", lifecycleState: .active, callerRole: .owner,
                    revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
                ),
                OutboxOperation(
                    id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "gardens.rename",
                    commandVersion: 1, targetRecordIds: ["garden-1"], expectedRevision: 0,
                    payload: #"{"recordType":"garden"}"#, createdAt: Date(timeIntervalSince1970: 0)
                )
            )
        }
        let applier = GardenSyncRecordApplier(localStore: store)
        let pulledFromAnotherDevice = Garden(
            id: "garden-1", name: "Server Name", lifecycleState: .active, callerRole: .owner,
            revision: 5, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )

        try await applier.applyUpsert(.garden(pulledFromAnotherDevice))

        #expect(try await store.fetchAll().first?.name == "Local Edit")
    }

    @Test("applyDelete is a deliberate no-op — see this stage's own scope note on garden revocation tombstones")
    func applyDeleteIsANoOp() async throws {
        let store = InMemoryGardenStore()
        try await store.save(Garden(
            id: "garden-1", name: "Backyard", lifecycleState: .active, callerRole: .owner,
            revision: 1, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        ))
        let applier = GardenSyncRecordApplier(localStore: store)

        try await applier.applyDelete(recordId: "garden-1", gardenId: nil, revision: 2)

        #expect(try await store.fetchAll().first?.id == "garden-1")
    }

    @Test("removeGardenScopedData removes the garden's own local row, even with a pending offline mutation queued")
    func removeGardenScopedDataRemovesGardenUnconditionally() async throws {
        let store = InMemoryGardenStore()
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (
                Garden(
                    id: "garden-1", name: "Local Edit", lifecycleState: .active, callerRole: .owner,
                    revision: 0, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
                ),
                OutboxOperation(
                    id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "gardens.rename",
                    commandVersion: 1, targetRecordIds: ["garden-1"], expectedRevision: 0,
                    payload: #"{"recordType":"garden"}"#, createdAt: Date(timeIntervalSince1970: 0)
                )
            )
        }
        let applier = GardenSyncRecordApplier(localStore: store)

        try await applier.removeGardenScopedData(gardenId: "garden-1")

        #expect(try await store.fetchAll().isEmpty)
    }
}
