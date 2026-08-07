import CoreDomain
import CoreNetworking
import FeatureMap
import Foundation

/// Placing a garden on the Earth — split from `AppCompositionRoot.swift` the
/// same way every other `AppCompositionRoot+*.swift` is, to keep that file
/// under this repository's 600-line rule.
extension AppCompositionRoot {
    /// One provider for the process. A location manager is a system resource,
    /// and a fresh one per screen would re-prompt and re-warm the radio each
    /// time the georeference sheet opened.
    @MainActor
    private static let locationProvider = DeviceLocationProvider()

    public func makeGeoreferenceViewModel(
        gardenId: String,
        existing: GardenGeoreference?
    ) -> GeoreferenceViewModel {
        let provider = Self.locationProvider
        return GeoreferenceViewModel(
            gardenId: gardenId,
            existing: existing,
            gateway: geographyGateway,
            strings: localizedStrings,
            locate: { await provider.currentFix() },
            heading: { await provider.currentHeading() }
        )
    }
}
