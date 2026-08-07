import CoreDomain
import CoreMediaTransfer
import CoreNetworking
import FeatureGardens
import FeatureMap
import Foundation

/// The plan-upload screen and the shared photo-attachment controller — split
/// from `AppCompositionRoot.swift` the same way every other
/// `AppCompositionRoot+*.swift` is, to keep that file under the 600-line rule.
extension AppCompositionRoot {
    /// The garden's property-plan upload screen (P6-PLAN iOS parity):
    /// the shared attachment controller with `media_class: 'imported_plan'`
    /// — the same background upload session as every photo attachment —
    /// plus the media gateway the processed plan's derivative preview is
    /// resolved through.
    public func makeGardenPlanUploadViewModel(gardenId: String) -> GardenPlanUploadViewModel {
        GardenPlanUploadViewModel(
            gardenId: gardenId,
            attachment: makePhotoAttachmentController(gardenId: gardenId, mediaClass: .importedPlan),
            mediaGateway: mediaGateway,
            strings: strings
        )
    }

    /// One fresh `PhotoAttachmentController` per screen (unlike
    /// `mediaUploadCoordinator` itself, this IS cheap and safe to construct
    /// per call — it holds no background session, only a subscription to
    /// the one shared coordinator's per-transfer update stream, torn down
    /// naturally once the screen's own view model is released) — wired to
    /// the single shared `mediaUploadCoordinator`, so every attachment
    /// still funnels through the one real background upload session
    /// regardless of which screen started it.
    func makePhotoAttachmentController(gardenId: String, mediaClass: MediaClass) -> PhotoAttachmentController {
        PhotoAttachmentController(
            coordinator: mediaUploadCoordinator,
            gardenId: gardenId,
            profileId: currentProfileIdentifier(),
            mediaClass: mediaClass
        )
    }
}
