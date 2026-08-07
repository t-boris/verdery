import CoreMediaTransfer
import CoreNetworking
import FeatureObservations
import Foundation

/// The observation-journal factories — split from `AppCompositionRoot.swift`
/// the same way every other `AppCompositionRoot+*.swift` is, to keep that file
/// under this repository's 600-line rule.
extension AppCompositionRoot {
    public func makeObservationsTimelineViewModel(gardenId: String) -> ObservationsTimelineViewModel {
        let store = localObservationStore()
        let profileId = currentProfileIdentifier()

        return ObservationsTimelineViewModel(
            gardenId: gardenId,
            recordObservation: RecordObservation(localStore: store, profileId: profileId),
            listObservationsForGarden: ListObservationsForGarden(gateway: observationGateway, localStore: store),
            listObservationsForPlant: ListObservationsForPlant(gateway: observationGateway),
            correctObservation: CorrectObservation(localStore: store, profileId: profileId),
            setHealthSuggestionDisposition: SetHealthSuggestionDisposition(gateway: observationGateway),
            strings: strings,
            // P6-IOS-01: real background-capable upload capability for the
            // record-observation form's photo attachment — see
            // `makePhotoAttachmentController`'s own doc comment.
            photoAttachment: makePhotoAttachmentController(gardenId: gardenId, mediaClass: .gardenPhoto)
        )
    }

    /// One plant's journal sequence (P11-MEDIA-01): the frames read straight
    /// from the server, and the media gateway each frame's signed URL is
    /// resolved through — the same pair `makePlantDetailViewModel`'s own photo
    /// gallery already uses.
    public func makePlantJournalViewModel(gardenId: String, plantId: String) -> PlantJournalViewModel {
        PlantJournalViewModel(
            gardenId: gardenId,
            plantId: plantId,
            listPlantJournalFrames: ListPlantJournalFrames(gateway: observationGateway),
            mediaGateway: mediaGateway,
            strings: strings
        )
    }
}
