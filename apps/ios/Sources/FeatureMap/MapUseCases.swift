import CoreDomain
import CoreNetworking
import Foundation

/// Fetches the whole garden map document and persists it into the local
/// `garden_object` read model, then returns the confirmed document.
///
/// Still always-fresh-from-server, never cache-first — unlike
/// `FeatureGardens.ListGardens.cached()`, there is no instant local read to
/// offer before this call resolves, and `MapEditorViewModel`'s own doc
/// comment's reasoning for that still holds even after P5-IOS-02 (Stage 4b):
/// every mutating command needs the *exact* revision the server last
/// assigned, which only a completed `GET .../map` can vouch for. The local
/// store this stage added exists only to give an offline command a durable
/// "current object state" to apply against and to survive process
/// termination — not to make this call itself feel instant, the way
/// `ListGardens.cached()` does for the garden list.
///
/// See `LocalMapStore.replaceAll(gardenId:with:)` for how the store this
/// persists into protects an object with a pending offline mutation from
/// being overwritten by this call's own (necessarily stale, until that
/// mutation syncs) server response.
public struct LoadGardenMap: Sendable {
    private let gateway: any MapGateway
    private let localStore: any LocalMapStore

    public init(gateway: any MapGateway, localStore: any LocalMapStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(gardenId: String) async throws -> GardenMapDocument {
        let document = try await gateway.getMap(gardenId: gardenId)
        try await localStore.replaceAll(gardenId: gardenId, with: document.objects)
        return document
    }
}

/// Submits one editor command, generating its idempotency key here — the
/// same responsibility split `GardensUseCases.swift` uses: the gateway
/// shapes the request, the use case supplies what varies per attempt.
///
/// Deliberately not called by `MapEditorViewModel` anymore as of P5-IOS-02
/// (Stage 4b) — `ApplyMapCommandOffline` below is what
/// `MapEditorViewModelEditing.submit`/`MapEditorViewModelUndoRedo.submitUndoRedo`
/// call instead now. Left intact, matching `FeatureGardens.GardenGateway`'s
/// identical treatment in Stage 4a, for a later stage's real push engine to
/// call.
public struct SubmitMapCommand: Sendable {
    private let gateway: any MapGateway

    public init(gateway: any MapGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, command: MapCommandPayload) async throws -> MapCommandResult {
        try await gateway.submitCommand(
            gardenId: gardenId,
            command: command,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Applies one map-editor command as a local-only transaction: no network
/// call. Validates the command locally, computes its optimistic local
/// projection, and enqueues a `map.*` outbox operation for a future
/// `SyncEngine` to push — architecture/offline-synchronization.md, section
/// "6. Local Mutation Transaction".
///
/// One method for all 11 reachable command types (12 counting
/// `upsertCalibration`/`decideProposal`, which throw
/// `MapCommandError.unsupportedCommand` — see `MapCommandProjection.apply`),
/// not one use case per command type the way `GardensUseCases.swift` needed
/// four separate ones: `SubmitMapCommand`'s own online precedent already
/// dispatches every command generically (`MapCommandPayload`, a single
/// discriminated union `MapGateway.submitCommand` accepts as-is), so this
/// offline counterpart keeps that same one-method shape.
public struct ApplyMapCommandOffline: Sendable {
    private let localStore: any LocalMapStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String

    public init(
        localStore: any LocalMapStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
    }

    public func callAsFunction(
        gardenId: String,
        coordinateSpaceId: String,
        command: MapCommandPayload
    ) async throws -> [GardenMapObject] {
        let timestamp = now()
        let operationId = generateOperationId()

        return try await localStore.commitOfflineMutation(gardenId: gardenId) { current in
            let projections = try MapCommandProjection.apply(
                command,
                to: current,
                gardenId: gardenId,
                coordinateSpaceId: coordinateSpaceId,
                now: timestamp
            )

            let operation = OutboxOperation(
                id: operationId,
                profileId: profileId,
                gardenId: gardenId,
                // Matches the backend's own operation-naming convention
                // exactly (`services/api/.../application/*.ts`'s `const
                // OPERATION = 'map.createObject'` and siblings), verified
                // against that source rather than invented — see
                // `MapCommandProjection`'s doc comment for the same
                // verification approach applied to the geometry math.
                commandType: "map.\(command.type.rawValue)",
                commandVersion: GardenObjectSyncCommandPayload.version,
                targetRecordIds: projections.map(\.id),
                expectedRevision: MapCommandProjection.primaryExpectedRevision(for: command),
                payload: try GardenObjectSyncCommandPayload.encode(gardenId: gardenId, command: command),
                createdAt: timestamp
            )
            return (projections, operation)
        }
    }
}
