import CoreDomain
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plant photo gallery controller")
struct PlantPhotoGalleryControllerTests {
    private func photo(id: String, mediaId: String, isPrimary: Bool = false) -> PlantPhoto {
        PlantPhoto(id: id, plantId: "plant-1", mediaId: mediaId, isPrimary: isPrimary, createdAt: Date(timeIntervalSince1970: 0))
    }

    @Test("load resolves every photo's signed access URL, in the order the gateway returned them")
    func loadResolvesEveryPhoto() async {
        let plantGateway = FakePlantGateway()
        plantGateway.plantPhotos = [
            photo(id: "photo-1", mediaId: "media-1", isPrimary: true),
            photo(id: "photo-2", mediaId: "media-2"),
        ]
        let mediaGateway = FakePlantsMediaGateway()
        mediaGateway.accessById = [
            "media-1": MediaAccess(url: URL(string: "https://example.com/media-1")!, expiresAt: Date(timeIntervalSince1970: 100)),
            "media-2": MediaAccess(url: URL(string: "https://example.com/media-2")!, expiresAt: Date(timeIntervalSince1970: 100)),
        ]
        let controller = PlantPhotoGalleryController(
            listPlantPhotos: ListPlantPhotos(gateway: plantGateway),
            mediaGateway: mediaGateway
        )

        await controller.load(gardenId: "garden-1", plantId: "plant-1")

        #expect(controller.photos.map(\.id) == ["photo-1", "photo-2"])
        #expect(controller.photos.map(\.url.absoluteString) == [
            "https://example.com/media-1", "https://example.com/media-2",
        ])
    }

    @Test("load drops a photo whose access URL fails to resolve rather than failing the whole gallery")
    func loadDropsUnresolvablePhoto() async {
        let plantGateway = FakePlantGateway()
        plantGateway.plantPhotos = [photo(id: "photo-1", mediaId: "media-1"), photo(id: "photo-2", mediaId: "media-2")]
        let mediaGateway = FakePlantsMediaGateway()
        mediaGateway.accessById = [
            "media-2": MediaAccess(url: URL(string: "https://example.com/media-2")!, expiresAt: Date(timeIntervalSince1970: 100)),
        ]
        let controller = PlantPhotoGalleryController(
            listPlantPhotos: ListPlantPhotos(gateway: plantGateway),
            mediaGateway: mediaGateway
        )

        await controller.load(gardenId: "garden-1", plantId: "plant-1")

        #expect(controller.photos.map(\.id) == ["photo-2"])
    }

    @Test("load clears the gallery to empty when listing the plant's photos itself fails")
    func loadClearsOnListFailure() async {
        let plantGateway = FakePlantGateway()
        plantGateway.listPlantPhotosError = URLError(.notConnectedToInternet)
        let controller = PlantPhotoGalleryController(
            listPlantPhotos: ListPlantPhotos(gateway: plantGateway),
            mediaGateway: FakePlantsMediaGateway()
        )

        await controller.load(gardenId: "garden-1", plantId: "plant-1")

        #expect(controller.photos.isEmpty)
    }
}
