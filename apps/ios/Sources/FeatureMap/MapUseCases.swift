import CoreDomain
import CoreNetworking

/// Fetches the whole garden map document.
///
/// No local read model behind this — see `MapEditorViewModel`'s doc comment
/// for the always-fresh-from-server decision — so, unlike `ListGardens`,
/// there is no `cached()` to offer before the network call resolves.
public struct LoadGardenMap: Sendable {
    private let gateway: any MapGateway

    public init(gateway: any MapGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> GardenMapDocument {
        try await gateway.getMap(gardenId: gardenId)
    }
}

/// Submits one editor command, generating its idempotency key here — the
/// same responsibility split `GardensUseCases.swift` uses: the gateway
/// shapes the request, the use case supplies what varies per attempt.
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
