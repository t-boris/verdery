#if os(iOS)
import UIKit

/// Where a native sign-in sheet is presented from.
///
/// One lookup, shared by both native providers: ``AppleSignInPresenter`` needs
/// a window to use as its `ASPresentationAnchor`, and ``GoogleSignInPresenter``
/// needs that window's root view controller to present from. Written once here
/// rather than twice, so the two flows cannot drift into disagreeing about
/// which window is the current one.
///
/// `@MainActor` because every value it touches is: `UIApplication.shared` and
/// each window's `isKeyWindow` are main-actor-isolated, and both callers are
/// already on the main actor.
@MainActor
enum SignInPresentation {
    /// The active scene's key window, or `nil` when the app has none.
    ///
    /// Callers treat `nil` as "cannot present" rather than trapping: an app
    /// with no key window cannot be showing the sign-in button that started
    /// this, so the branch is unreachable in practice, and crashing would be a
    /// worse answer than reporting an error the screen can display.
    static func keyWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }
    }
}
#endif
