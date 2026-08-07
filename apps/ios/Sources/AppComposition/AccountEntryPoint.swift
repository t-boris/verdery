import CoreDesignSystem
import CoreLocalization
import CoreMediaTransfer
import CorePersistence
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
    /// The account-deletion screen (App Store Guideline 5.1.1(v)).
    ///
    /// The teardown closure is the reason this factory lives here rather than
    /// in the feature: only the composition root knows everything this device
    /// holds for a profile, and every part of it has to go.
    /// `ios-distribution.md` section 10.3 is blunt about why — a database left
    /// behind "would repopulate the UI from cache and look like it failed",
    /// so somebody who just deleted their account would watch their gardens
    /// come back.
    public func makeDeleteAccountViewModel() -> DeleteAccountViewModel {
        DeleteAccountViewModel(
            gateway: accountGateway,
            strings: localizedStrings
        ) { [unowned self] in
            let profileIdentifier = self.currentProfileIdentifier()

            // The cache first, so nothing can render a photograph out of it
            // after the record it belonged to is gone.
            await self.mediaImageCache.removeAll()

            // Then the whole profile directory: the database, its `-wal` and
            // `-shm` companions, and the media files beside them. Deleting the
            // directory rather than the database file is deliberate — the
            // journal companions hold recent writes.
            LocalDatabase.deleteProfileStore(profileIdentifier: profileIdentifier)

            // Apple requires revocation on deletion, not merely a sign-out,
            // and checks for it at review — see `AppleAuthorizationCodeStore`
            // for the code this needs and where it comes from.
            await self.authenticationGateway.revokeAppleTokenAndSignOut()
        }
    }

    /// The data-export screen.
    ///
    /// Scoped to the account rather than to a garden: the account sheet is
    /// reachable from every screen including the gardens list, where no garden
    /// is chosen, so offering "this garden" from here would sometimes mean
    /// nothing.
    public func makeExportViewModel() -> ExportViewModel {
        ExportViewModel(gateway: exportGateway, gardenId: nil, strings: localizedStrings)
    }

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
                    ProfileView(
                        model: composition.makeProfileViewModel(),
                        makeDeleteModel: composition.makeDeleteAccountViewModel,
                        makeExportModel: composition.makeExportViewModel
                    )
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
    ///
    /// Still used by the gardens list, which has no console chassis under it —
    /// there is no garden yet, so there is no status to report. Inside a
    /// garden the avatar lives in the strip instead; see ``accountSheet``.
    func accountToolbar(composition: AppCompositionRoot) -> some View {
        modifier(AccountToolbarModifier(composition: composition))
    }

    /// The same sheet, without the button — for the shell that raises it from
    /// the console strip's avatar rather than from a toolbar slot.
    func accountSheet(
        composition: AppCompositionRoot,
        isPresented: Binding<Bool>
    ) -> some View {
        sheet(isPresented: isPresented) {
            NavigationStack {
                ProfileView(
                        model: composition.makeProfileViewModel(),
                        makeDeleteModel: composition.makeDeleteAccountViewModel,
                        makeExportModel: composition.makeExportViewModel
                    )
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button(composition.localizedStrings(.plantsClose)) {
                                isPresented.wrappedValue = false
                            }
                        }
                    }
            }
        }
    }
}

extension AppCompositionRoot {
    /// The one or two letters the console strip shows in place of a photograph.
    public var accountInitials: String {
        AccountInitials.from(
            displayName: sessionObserver.currentAccount?.displayName,
            emailAddress: sessionObserver.currentAccount?.emailAddress,
            locale: locale
        )
    }
}
