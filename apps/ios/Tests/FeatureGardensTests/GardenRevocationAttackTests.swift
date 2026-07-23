import CoreDomain
import CoreNetworking
import CorePersistence
import CoreSynchronization
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureGardens

/// The "Offline removal attack" scenario named as P5-SEC-01's own completion
/// evidence: proves that once a garden's access-revocation tombstone has
/// been pulled and applied, every local trace of that garden — including a
/// still-pending offline mutation queued against it — is gone, AND makes
/// explicit the one deliberate, understood exception: a device that is
/// OFFLINE at the moment revocation happens server-side can still read and
/// edit that garden locally for exactly one more offline session, because
/// the client genuinely has no way to learn about revocation before its
/// next successful pull. This is a real, documented security boundary, not
/// an unnoticed gap — the two tests below make it explicit, in order.
///
/// Uses real `GRDBGardenStore`/`GRDBSyncOutboxStore`/`GRDBSyncConflictStore`/
/// `GRDBSyncOperationResultStore`/`GRDBSyncCursorStore` against one shared
/// GRDB database, and a real `RemoteSyncEngine`/`GardenSyncRecordApplier` —
/// the same "real database, not a store double" approach
/// `GardenOfflineMutationTests` already establishes for this target, applied
/// here to the full pull-and-cascade path instead of one store method at a
/// time. The cascade itself reaching every OTHER registered applier
/// (`garden_object`/`plant`/`observation`/`task`) is proven at the engine
/// level, with fakes, in `CoreSynchronizationTests
/// .RemoteSyncEnginePullTests.gardenDeleteCascadesToEveryRegisteredApplier`,
/// and at each feature's own store level in that feature's own test target
/// (`MapSyncRecordApplierTests`/`PlantSyncRecordApplierTests`/
/// `ObservationSyncRecordApplierTests`/`TaskSyncRecordApplierTests`'s own
/// `removeGardenScopedData` coverage, plus each feature's own
/// `*OfflineMutationTests.removeAll` GRDB coverage) — this suite does not
/// duplicate that here by wiring every feature module into one integration
/// target, which would mean adding all five `Feature*` modules as test-only
/// dependencies of `CoreSynchronizationTests`, widening that target's
/// dependency graph past what P5-SEC-01's own scope calls for.
@Suite("Garden revocation removal — offline attack")
struct GardenRevocationAttackTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func garden(id: String, name: String, revision: Int) -> Garden {
        Garden(
            id: id, name: name, lifecycleState: .active, callerRole: .owner,
            revision: revision, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func renameOfflineOperation(expectedRevision: Int) -> OutboxOperation {
        OutboxOperation(
            id: "op-rename", profileId: "profile-1", gardenId: "garden-1", commandType: "gardens.rename",
            commandVersion: 1, targetRecordIds: ["garden-1"], expectedRevision: expectedRevision,
            payload: #"{"recordType":"garden"}"#, createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("Before the revocation tombstone is pulled, offline editing of the (already, unknowably) revoked garden still succeeds — the understood attack window")
    func offlineEditingSucceedsBeforeTombstoneIsPulled() async throws {
        let dbQueue = try makeDatabase()
        let gardenStore = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        // This device already cached garden-1 from a prior, successful pull
        // — back when it still had access.
        try await gardenStore.save(garden(id: "garden-1", name: "Backyard", revision: 3))

        // The server has ALREADY revoked this device's access to garden-1 —
        // unbeknownst to this device, which is offline and has not pulled
        // since. A local rename must still succeed: the client genuinely
        // cannot know about revocation before its next successful pull.
        let renamed = try await gardenStore.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current?.name == "Backyard")
            return (self.garden(id: "garden-1", name: "Renamed Offline", revision: 3), self.renameOfflineOperation(expectedRevision: 3))
        }

        #expect(renamed.name == "Renamed Offline")
        #expect(try await gardenStore.fetchAll().first?.name == "Renamed Offline")
        #expect(try await outbox.fetchPending(gardenId: "garden-1").map(\.id) == ["op-rename"])
    }

    @Test("The attack window closes at the next successful pull: the revocation tombstone removes the garden's row and the still-pending rename together")
    func tombstonePullClosesTheAttackWindow() async throws {
        let dbQueue = try makeDatabase()
        let gardenStore = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await gardenStore.save(garden(id: "garden-1", name: "Backyard", revision: 3))
        // Same offline rename as the previous test — proves the pending
        // operation THIS offline session created is what actually gets
        // swept, not merely a garden with no outbox activity at all.
        _ = try await gardenStore.commitOfflineMutation(gardenId: "garden-1") { _ in
            (self.garden(id: "garden-1", name: "Renamed Offline", revision: 3), self.renameOfflineOperation(expectedRevision: 3))
        }
        // A different garden this device also has cached — proves the
        // cascade scopes strictly to the revoked garden, not every garden.
        try await gardenStore.save(garden(id: "garden-2", name: "Front Yard", revision: 1))

        let gateway = FakeRevocationGateway()
        await gateway.setPage(SyncChangesPage(
            items: [SyncChange(
                sequence: 1, gardenId: "garden-1", recordId: "garden-1", recordType: "garden",
                operation: .delete, recordRevision: 4, committedAt: Date(timeIntervalSince1970: 0), snapshot: nil
            )],
            nextCursor: "cursor-1"
        ))
        let engine = RemoteSyncEngine(
            outboxStore: outbox,
            conflictStore: GRDBSyncConflictStore(dbQueue: dbQueue),
            operationResultStore: GRDBSyncOperationResultStore(dbQueue: dbQueue),
            gateway: gateway,
            clientInstallationStore: FakeClientInstallationIdentityStore(id: "install-1"),
            cursorStore: GRDBSyncCursorStore(dbQueue: dbQueue),
            appliers: [GardenSyncRecordApplier(localStore: gardenStore)],
            appVersion: "1.0.0",
            pullPageLimit: 100,
            now: { Date(timeIntervalSince1970: 1_000) },
            randomUnitInterval: { 1.0 }
        )

        // Connectivity returns; a pull succeeds — this is the FIRST moment
        // this device can possibly learn about the revocation.
        try await engine.pullChanges()

        // (a) The garden's own local row is gone — it no longer appears via
        // `fetchAll()`, the read path every garden-list screen uses.
        let remaining = try await gardenStore.fetchAll()
        #expect(remaining.map(\.id) == ["garden-2"])

        // (b) The still-pending rename THIS exact offline session queued is
        // gone too — swept proactively, not left to be attempted-and-
        // rejected on the next push.
        #expect(try await outbox.fetchPending(gardenId: "garden-1").isEmpty)

        // (c) garden-2, untouched by the revocation, survives with its own
        // local state intact.
        #expect(remaining.first?.name == "Front Yard")
    }
}

/// Fake `SyncGateway` local to this suite — only `getChanges` is
/// meaningfully stubbed, mirroring `CoreSynchronizationTests
/// .RemoteSyncEnginePullTests.FakePullSyncGateway`'s identical role.
private actor FakeRevocationGateway: SyncGateway {
    private var page = SyncChangesPage(items: [], nextCursor: "cursor-0")

    func setPage(_ page: SyncChangesPage) {
        self.page = page
    }

    func registerClient(clientInstallationId: String, appVersion: String, protocolVersion: Int) async throws {}

    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] { [] }

    func acknowledge(clientInstallationId: String, operationIds: [String]) async throws -> [SyncPushOperationOutcome] { [] }

    func getChanges(protocolVersion: Int, after: String?, limit: Int) async throws -> SyncChangesPage { page }
}

private struct FakeClientInstallationIdentityStore: ClientInstallationIdentityStore {
    let id: String

    func currentOrGenerated() async throws -> String { id }
}
