import CoreDomain
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
}
