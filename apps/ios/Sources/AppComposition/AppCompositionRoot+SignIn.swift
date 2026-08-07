import CoreAuthentication
import FeatureAuthentication
import Foundation

/// The sign-in screen's factory — split from `AppCompositionRoot.swift` the
/// same way every other `AppCompositionRoot+*.swift` is, to keep that file
/// under this repository's 600-line rule.
extension AppCompositionRoot {
    public func makeSignInViewModel() -> SignInViewModel {
        SignInViewModel(authenticationGateway: authenticationGateway, strings: strings)
    }

    // `handleIncomingURL(_:)` — routes a URL the OS delivered to the app,
    // including this app's own `verdery://` collaboration deep links — lives
    // in `AppCompositionRoot+DeepLinks.swift`, split out purely to keep this
    // file under this repository's 600-line rule, the same
    // `AppCompositionRoot+LocalStores.swift`/`AccountEntryPoint.swift`
    // precedent.
}
