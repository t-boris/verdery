import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

/// `PlantDetailViewModel`'s own photo-gallery wiring, split out of
/// `PlantDetailViewModelTests.swift` for the same 600-line reason
/// `PlantDetailMapObjectPickerTests.swift` split out of it.
@MainActor
@Suite("Plant detail view model — photo gallery")
struct PlantDetailPhotoGalleryTests {
    private func plant(revision: Int = 1) -> Plant {
        Plant(
            id: "plant-1", gardenId: "garden-1", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: "Tomato", taxonomyReferenceId: nil, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: .individual, quantity: nil,
            lifecycleStage: .seedling, status: .active, conditionNote: nil, careGuidanceNote: nil, revision: revision,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(
        gateway: FakePlantGateway,
        mediaGateway: FakePlantsMediaGateway? = nil
    ) -> PlantDetailViewModel {
        let localStore = InMemoryPlantStore()
        return PlantDetailViewModel(
            gardenId: "garden-1",
            plantId: "plant-1",
            getPlant: GetPlant(gateway: gateway, localStore: localStore),
            updatePlantDetails: UpdatePlantDetails(localStore: localStore, profileId: "profile-1"),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(localStore: localStore, profileId: "profile-1"),
            setPlantStatus: SetPlantStatus(localStore: localStore, profileId: "profile-1"),
            movePlant: MovePlant(localStore: localStore, profileId: "profile-1"),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB")),
            attachPlantPhoto: AttachPlantPhoto(gateway: gateway, generateIdempotencyKey: { "fixed-key" }),
            photoGallery: mediaGateway.map {
                PlantPhotoGalleryController(listPlantPhotos: ListPlantPhotos(gateway: gateway), mediaGateway: $0)
            }
        )
    }

    @Test("load populates the photo gallery from the plant's attached photos")
    func loadPopulatesGallery() async {
        let gateway = FakePlantGateway(plants: [plant()])
        gateway.plantPhotos = [
            PlantPhoto(id: "photo-1", plantId: "plant-1", mediaId: "media-1", isPrimary: true, createdAt: Date(timeIntervalSince1970: 0)),
        ]
        let mediaGateway = FakePlantsMediaGateway()
        mediaGateway.accessById = [
            "media-1": MediaAccess(url: URL(string: "https://example.com/media-1")!, expiresAt: Date(timeIntervalSince1970: 100)),
        ]
        let model = makeModel(gateway: gateway, mediaGateway: mediaGateway)

        await model.load()

        #expect(model.photoGallery?.photos.map(\.id) == ["photo-1"])
    }

    @Test("load with no photo-gallery capability wired in is a no-op, not a crash")
    func loadNoOpWithoutCapability() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let model = makeModel(gateway: gateway)

        await model.load()

        #expect(model.photoGallery == nil)
    }

    @Test("attaching a picked photo refreshes the gallery")
    func attachRefreshesGallery() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let mediaGateway = FakePlantsMediaGateway()
        let model = makeModel(gateway: gateway, mediaGateway: mediaGateway)
        await model.load()
        #expect(model.photoGallery?.photos.isEmpty == true)

        gateway.plantPhotos = [
            PlantPhoto(id: "photo-1", plantId: "plant-1", mediaId: "media-1", isPrimary: true, createdAt: Date(timeIntervalSince1970: 0)),
        ]
        mediaGateway.accessById = [
            "media-1": MediaAccess(url: URL(string: "https://example.com/media-1")!, expiresAt: Date(timeIntervalSince1970: 100)),
        ]

        await model.attachPickedPhoto(mediaId: "media-1")

        #expect(model.photoGallery?.photos.map(\.id) == ["photo-1"])
    }
}
