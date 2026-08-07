import CoreNetworking
import FeatureGardens
import Foundation

/// The garden-settings factory — split from `AppCompositionRoot.swift` the same
/// way every other `AppCompositionRoot+*.swift` is, to keep that file under
/// this repository's 600-line rule.
extension AppCompositionRoot {
    public func makeGardenSettingsViewModel(gardenId: String) -> GardenSettingsViewModel {
        let store = localGardenStore()
        let profileId = currentProfileIdentifier()

        return GardenSettingsViewModel(
            gardenId: gardenId,
            listGardens: ListGardens(gateway: gardenGateway, localStore: store),
            getGarden: GetGarden(gateway: gardenGateway, localStore: store),
            renameGarden: RenameGarden(localStore: store, profileId: profileId),
            archiveGarden: ArchiveGarden(localStore: store, profileId: profileId),
            requestGardenDeletion: RequestGardenDeletion(localStore: store, profileId: profileId),
            strings: strings
        )
    }
}
