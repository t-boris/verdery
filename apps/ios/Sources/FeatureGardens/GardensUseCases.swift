import CoreDomain
import CoreNetworking
import Foundation

/// Refreshes the local read model from the server and returns the confirmed
/// list. Errors are the caller's to handle; the local cache is left
/// unchanged on failure so a stale list stays visible rather than emptying.
///
/// Still an online, gateway-backed read — not one of the four offline
/// commands P5-IOS-02 retrofitted. See `LocalGardenStore.replaceAll(with:)`
/// for how the cache this reads from now protects a garden with a pending
/// offline mutation from being overwritten by this call's own (necessarily
/// stale, until that mutation syncs) server response.
public struct ListGardens: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    /// The immediately-available cached list, before any network call.
    public func cached() async throws -> [Garden] {
        try await localStore.fetchAll()
    }

    public func callAsFunction() async throws -> [Garden] {
        let page = try await gateway.list(cursor: nil)
        try await localStore.replaceAll(with: page.items)
        return page.items
    }
}

/// Still an online, gateway-backed read — see `ListGardens`'s doc comment.
public struct GetGarden: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(gardenId: String) async throws -> Garden {
        let garden = try await gateway.get(gardenId: gardenId)
        try await localStore.save(garden)
        return garden
    }
}

/// Creates a garden as one local-only transaction: no network call.
///
/// Validates the name, assigns a client-generated garden ID, applies the
/// optimistic local projection, and enqueues a `gardens.create` outbox
/// operation for a future `SyncEngine` to push — architecture/offline-
/// synchronization.md, section "6. Local Mutation Transaction".
/// `CoreNetworking.GardenGateway.create` is deliberately not called from
/// here anymore (P5-IOS-02); it stays intact for a later stage's real push
/// engine to call instead.
public struct CreateGarden: Sendable {
    private let localStore: any LocalGardenStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String
    private let generateGardenId: @Sendable () -> String

    public init(
        localStore: any LocalGardenStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate,
        generateGardenId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
        self.generateGardenId = generateGardenId
    }

    public func callAsFunction(name: String) async throws -> Garden {
        let trimmedName = try validatedGardenName(name)
        let gardenId = generateGardenId()
        let timestamp = now()
        let operationId = generateOperationId()

        return try await localStore.commitOfflineMutation(gardenId: gardenId) { current in
            // `current` is always `nil` here: `gardenId` was just generated
            // by `generateGardenId()` above and cannot already have a local
            // row.
            let projection = Garden(
                id: gardenId,
                name: trimmedName,
                lifecycleState: .active,
                callerRole: .owner,
                revision: unconfirmedGardenRevision,
                createdAt: timestamp,
                updatedAt: timestamp
            )
            let operation = OutboxOperation(
                id: operationId,
                profileId: profileId,
                gardenId: gardenId,
                commandType: "gardens.create",
                commandVersion: GardenSyncCommandPayload.version,
                targetRecordIds: [gardenId],
                expectedRevision: nil,
                payload: try GardenSyncCommandPayload.encode(gardenId: gardenId, command: .create(name: trimmedName)),
                createdAt: timestamp
            )
            return (projection, operation)
        }
    }
}

/// Renames a garden as one local-only transaction: no network call. See
/// `CreateGarden`'s doc comment for the shared rationale.
public struct RenameGarden: Sendable {
    private let localStore: any LocalGardenStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String

    public init(
        localStore: any LocalGardenStore,
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
        name: String,
        expectedRevision: Int
    ) async throws -> Garden {
        let trimmedName = try validatedGardenName(name)
        let timestamp = now()
        let operationId = generateOperationId()

        return try await localStore.commitOfflineMutation(gardenId: gardenId) { current in
            guard let current else {
                throw GardenCommandError.localRecordNotFound
            }

            let projection = Garden(
                id: current.id,
                name: trimmedName,
                lifecycleState: current.lifecycleState,
                callerRole: current.callerRole,
                revision: current.revision,
                createdAt: current.createdAt,
                updatedAt: timestamp
            )
            let operation = OutboxOperation(
                id: operationId,
                profileId: profileId,
                gardenId: gardenId,
                commandType: "gardens.rename",
                commandVersion: GardenSyncCommandPayload.version,
                targetRecordIds: [gardenId],
                expectedRevision: expectedRevision,
                payload: try GardenSyncCommandPayload.encode(
                    gardenId: gardenId,
                    command: .rename(name: trimmedName, expectedRevision: expectedRevision)
                ),
                createdAt: timestamp
            )
            return (projection, operation)
        }
    }
}

/// Archives a garden as one local-only transaction: no network call. See
/// `CreateGarden`'s doc comment for the shared rationale.
public struct ArchiveGarden: Sendable {
    private let localStore: any LocalGardenStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String

    public init(
        localStore: any LocalGardenStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
    }

    public func callAsFunction(gardenId: String, expectedRevision: Int) async throws -> Garden {
        let timestamp = now()
        let operationId = generateOperationId()

        return try await localStore.commitOfflineMutation(gardenId: gardenId) { current in
            guard let current else {
                throw GardenCommandError.localRecordNotFound
            }

            let projection = Garden(
                id: current.id,
                name: current.name,
                lifecycleState: .archived,
                callerRole: current.callerRole,
                revision: current.revision,
                createdAt: current.createdAt,
                updatedAt: timestamp
            )
            let operation = OutboxOperation(
                id: operationId,
                profileId: profileId,
                gardenId: gardenId,
                commandType: "gardens.archive",
                commandVersion: GardenSyncCommandPayload.version,
                targetRecordIds: [gardenId],
                expectedRevision: expectedRevision,
                payload: try GardenSyncCommandPayload.encode(
                    gardenId: gardenId,
                    command: .archive(expectedRevision: expectedRevision)
                ),
                createdAt: timestamp
            )
            return (projection, operation)
        }
    }
}

/// Requests deletion of a garden as one local-only transaction: no network
/// call. See `CreateGarden`'s doc comment for the shared rationale.
///
/// A status transition to `deletionRequested`, not a sync tombstone — the
/// same distinction the contract draws for `SyncRequestGardenDeletionCommand`
/// (`commandType: gardens.delete_request`).
public struct RequestGardenDeletion: Sendable {
    private let localStore: any LocalGardenStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String

    public init(
        localStore: any LocalGardenStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
    }

    public func callAsFunction(gardenId: String, expectedRevision: Int) async throws -> Garden {
        let timestamp = now()
        let operationId = generateOperationId()

        return try await localStore.commitOfflineMutation(gardenId: gardenId) { current in
            guard let current else {
                throw GardenCommandError.localRecordNotFound
            }

            let projection = Garden(
                id: current.id,
                name: current.name,
                lifecycleState: .deletionRequested,
                callerRole: current.callerRole,
                revision: current.revision,
                createdAt: current.createdAt,
                updatedAt: timestamp
            )
            let operation = OutboxOperation(
                id: operationId,
                profileId: profileId,
                gardenId: gardenId,
                commandType: "gardens.delete_request",
                commandVersion: GardenSyncCommandPayload.version,
                targetRecordIds: [gardenId],
                expectedRevision: expectedRevision,
                payload: try GardenSyncCommandPayload.encode(
                    gardenId: gardenId,
                    command: .requestDeletion(expectedRevision: expectedRevision)
                ),
                createdAt: timestamp
            )
            return (projection, operation)
        }
    }
}

/// A garden created offline has no server-assigned revision yet. `0` is
/// below the contract's `Revision` minimum of `1`
/// (`packages/api-contracts/openapi.yaml`), so it can never be mistaken for
/// a real server revision, and is deliberately not `nil`: `Garden.revision`
/// stays a plain `Int` because every other read path (`GetGarden`,
/// `ListGardens`) always has a real one, and threading `Int?` through the
/// whole feature for this one local-only case was judged not worth it for
/// this pilot stage — a documented judgment call, not an oversight.
private let unconfirmedGardenRevision = 0

/// The contract's shared length rule for a garden's name
/// (`packages/api-contracts/openapi.yaml`, `CreateGardenRequest.name` /
/// `RenameGardenRequest.name`, `minLength: 1, maxLength: 120`) — also what
/// the catalogue's `gardens.name.required` string already describes ("Enter
/// a name up to 120 characters"). That key predates this stage but nothing
/// enforced it client-side yet; step 2 of the local mutation transaction
/// (architecture/offline-synchronization.md, section "6") is where it
/// belongs now that an offline command has nowhere else to be checked before
/// it is queued.
private let gardenNameMaxLength = 120

private func validatedGardenName(_ name: String) throws -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !trimmed.isEmpty, trimmed.count <= gardenNameMaxLength else {
        throw GardenCommandError.invalidName
    }

    return trimmed
}
