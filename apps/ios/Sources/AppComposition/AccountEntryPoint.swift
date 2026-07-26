import CoreDesignSystem
import CoreLocalization
import FeatureAuthentication
import Foundation
import SwiftUI

/// The account screen's entry point, and the factory behind it.
///
/// Lives in its own file rather than in `AppCompositionRoot.swift` for the
/// reason that file's own size already argues: it is at the repository's
/// 600-line ceiling, and a same-type extension is how this module already
/// splits (see `AppCompositionRoot+LocalStores.swift`).
extension AppCompositionRoot {
    /// The account screen (see `FeatureAuthentication.ProfileView`).
    ///
    /// The identity is read from `sessionObserver` at the moment the sheet is
    /// built, which is correct because the sheet only exists while someone is
    /// signed in and the shell tears it down when that stops being true.
    ///
    /// The version and build are read straight from the bundle, and stay
    /// optional: `CFBundleShortVersionString`/`CFBundleVersion` are absent
    /// from the headless SPM executable, and the screen omits a figure it
    /// cannot state rather than printing a placeholder.
    public func makeProfileViewModel() -> ProfileViewModel {
        ProfileViewModel(
            account: sessionObserver.currentAccount,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            appBuild: Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
            locale: locale,
            authenticationGateway: authenticationGateway,
            strings: localizedStrings
        )
    }
}

/// The account button, and the sheet behind it.
///
/// Placed in the leading toolbar slot of both signed-in shells — the garden
/// list and, beside the garden button, every tab of one garden. That is the
/// slot this shell already uses for "who and where you are", with the trailing
/// slot left to whatever the screen underneath does; a sixth tab was not an
/// option for the same reason `GardenTabView` gives for the five it has.
///
/// A sheet rather than a pushed screen: an account is not part of any tab's
/// history, and a modal returns the reader exactly where they were.
struct AccountToolbarModifier: ViewModifier {
    let composition: AppCompositionRoot

    @State private var isPresented = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button {
                        isPresented = true
                    } label: {
                        Label(
                            composition.localizedStrings(.profileTitle),
                            systemImage: "person.crop.circle.fill"
                        )
                        .labelStyle(.iconOnly)
                    }
                    .accessibilityIdentifier("shell.account")
                }
            }
            .sheet(isPresented: $isPresented) {
                NavigationStack {
                    ProfileView(model: composition.makeProfileViewModel())
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button(composition.localizedStrings(.plantsClose)) {
                                    isPresented = false
                                }
                            }
                        }
                }
            }
    }
}

extension View {
    /// Adds the account button and its sheet to a shell's navigation bar.
    func accountToolbar(composition: AppCompositionRoot) -> some View {
        modifier(AccountToolbarModifier(composition: composition))
    }
}
