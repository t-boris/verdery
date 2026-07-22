import CoreDomain
import CoreNetworking

/// Refreshes the local read model from the server and returns the confirmed
/// list. Errors are the caller's to handle; the local cache is left
/// unchanged on failure so a stale list stays visible rather than emptying.
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

public struct CreateGarden: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(name: String) async throws -> Garden {
        let garden = try await gateway.create(name: name, idempotencyKey: UUIDv7.generate())
        try await localStore.save(garden)
        return garden
    }
}

public struct RenameGarden: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(
        gardenId: String,
        name: String,
        expectedRevision: Int
    ) async throws -> Garden {
        let garden = try await gateway.rename(
            gardenId: gardenId,
            name: name,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
        try await localStore.save(garden)
        return garden
    }
}

public struct ArchiveGarden: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(gardenId: String, expectedRevision: Int) async throws -> Garden {
        let garden = try await gateway.archive(
            gardenId: gardenId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
        try await localStore.save(garden)
        return garden
    }
}

public struct RequestGardenDeletion: Sendable {
    private let gateway: any GardenGateway
    private let localStore: any LocalGardenStore

    public init(gateway: any GardenGateway, localStore: any LocalGardenStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    public func callAsFunction(gardenId: String, expectedRevision: Int) async throws -> Garden {
        let garden = try await gateway.requestDeletion(
            gardenId: gardenId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
        try await localStore.save(garden)
        return garden
    }
}
