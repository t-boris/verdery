import CoreMediaTransfer
import FeaturePlants

/// The plants feature's screen factories — split from `AppCompositionRoot.swift`
/// the same way `AppCompositionRoot+Collaboration.swift`/
/// `AppCompositionRoot+LocalStores.swift` already are, purely to keep that
/// file under this repository's 600-line rule.
extension AppCompositionRoot {
    public func makePlantsHomeViewModel(gardenId: String) -> PlantsHomeViewModel {
        let store = localPlantStore()
        let profileId = currentProfileIdentifier()

        return PlantsHomeViewModel(
            gardenId: gardenId,
            addPlant: AddPlant(localStore: store, profileId: profileId),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: plantGateway),
            strings: strings,
            listGardenMapObjects: ListGardenMapObjects(gateway: mapGateway)
        )
    }

    public func makePlantsListViewModel(gardenId: String) -> PlantsListViewModel {
        PlantsListViewModel(
            gardenId: gardenId,
            searchPlants: SearchPlants(gateway: plantGateway),
            strings: strings,
            mediaGateway: mediaGateway
        )
    }

    public func makePlantDetailViewModel(gardenId: String, plantId: String) -> PlantDetailViewModel {
        let store = localPlantStore()
        let profileId = currentProfileIdentifier()

        return PlantDetailViewModel(
            gardenId: gardenId,
            plantId: plantId,
            getPlant: GetPlant(gateway: plantGateway, localStore: store),
            updatePlantDetails: UpdatePlantDetails(localStore: store, profileId: profileId),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(localStore: store, profileId: profileId),
            setPlantStatus: SetPlantStatus(localStore: store, profileId: profileId),
            movePlant: MovePlant(localStore: store, profileId: profileId),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: plantGateway),
            strings: strings,
            // P6-IOS-01: real background-capable upload capability for the
            // "Attach Photo" affordance — see `makePhotoAttachmentController`'s
            // own doc comment.
            photoAttachment: makePhotoAttachmentController(gardenId: gardenId, mediaClass: .gardenPhoto),
            attachPlantPhoto: AttachPlantPhoto(gateway: plantGateway),
            // ADR-0015: the plant-detail screen's own pending-identification
            // banner — see `PlantDetailViewModel.pendingIdentification`'s own
            // doc comment.
            fetchPlantIdentification: FetchPlantIdentification(gateway: plantGateway),
            confirmPlantIdentification: ConfirmPlantIdentification(gateway: plantGateway),
            listGardenMapObjects: ListGardenMapObjects(gateway: mapGateway),
            photoGallery: PlantPhotoGalleryController(
                listPlantPhotos: ListPlantPhotos(gateway: plantGateway),
                mediaGateway: mediaGateway
            ),
            observationSuggestion: ObservationSuggestionController(
                recordObservationFromIdentification: RecordObservationFromIdentification(gateway: plantGateway),
                strings: strings
            )
        )
    }

    /// The same real, background-capable upload capability
    /// `makePlantDetailViewModel`'s "Attach Photo" affordance already wires,
    /// reused here rather than duplicated — see `makePhotoAttachmentController`'s
    /// own doc comment. `AddPlantFromPhoto`/`ConfirmPlantIdentification`/
    /// `FetchPlantIdentification` are the three gateway-only use cases
    /// `PlantsUseCases.swift`'s own doc comment previously named as reachable
    /// from no real UI flow.
    public func makePlantAddFromPhotoViewModel(gardenId: String) -> PlantAddFromPhotoViewModel {
        PlantAddFromPhotoViewModel(
            gardenId: gardenId,
            addPlantFromPhoto: AddPlantFromPhoto(gateway: plantGateway),
            fetchPlantIdentification: FetchPlantIdentification(gateway: plantGateway),
            confirmPlantIdentification: ConfirmPlantIdentification(gateway: plantGateway),
            strings: strings,
            photoAttachment: makePhotoAttachmentController(gardenId: gardenId, mediaClass: .gardenPhoto),
            observationSuggestion: ObservationSuggestionController(
                recordObservationFromIdentification: RecordObservationFromIdentification(gateway: plantGateway),
                strings: strings
            )
        )
    }
}
