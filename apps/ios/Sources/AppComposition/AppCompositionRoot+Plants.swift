import CoreMediaTransfer
import FeaturePlants

/// The "Add plant from photo" screen's factory (ADR-0015) — split from
/// `AppCompositionRoot.swift` the same way `AppCompositionRoot+Collaboration
/// .swift`/`AppCompositionRoot+LocalStores.swift` already are, purely to keep
/// that file under this repository's 600-line rule.
extension AppCompositionRoot {
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
            photoAttachment: makePhotoAttachmentController(gardenId: gardenId, mediaClass: .gardenPhoto)
        )
    }
}
