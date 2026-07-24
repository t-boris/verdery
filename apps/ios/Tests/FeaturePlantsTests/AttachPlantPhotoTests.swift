import CoreDomain
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@Suite("Attach plant photo")
struct AttachPlantPhotoTests {
    @Test("calls the gateway with the given mediaId and a generated idempotency key")
    func callsGatewayWithMediaId() async throws {
        let gateway = FakePlantGateway(plants: [])
        let attach = AttachPlantPhoto(gateway: gateway, generateIdempotencyKey: { "fixed-key" })

        let photo = try await attach(gardenId: "garden-1", plantId: "plant-1", mediaId: "media-42")

        #expect(photo.plantId == "plant-1")
        #expect(photo.mediaId == "media-42")
    }

    @Test("propagates a gateway failure")
    func propagatesGatewayFailure() async throws {
        let gateway = FakePlantGateway(plants: [])
        gateway.attachPlantPhotoError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let attach = AttachPlantPhoto(gateway: gateway)

        await #expect(throws: Error.self) {
            _ = try await attach(gardenId: "garden-1", plantId: "plant-1", mediaId: "media-1")
        }
    }
}
