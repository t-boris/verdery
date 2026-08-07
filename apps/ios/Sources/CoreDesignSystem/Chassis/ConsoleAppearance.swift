import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Paints the tab bar and navigation bar as part of the console chassis.
///
/// SwiftUI can set a tab bar's background through `.toolbarBackground`, but it
/// cannot set the item font or the unselected tint, and Field Console needs
/// both: the tab labels are the 10-point mono uppercase label token, and an
/// unselected tab is `consoleMuted` rather than the system's grey. So this
/// reaches for `UITabBarAppearance` once, at launch, instead of every screen
/// fighting the defaults.
///
/// Call ``install()`` from the application entry point before the first window
/// appears.
public enum ConsoleAppearance {
    /// Configures the shared appearance proxies. Idempotent.
    public static func install() {
        #if canImport(UIKit)
        Fonts.register()

        let tabBar = UITabBarAppearance()
        tabBar.configureWithOpaqueBackground()
        tabBar.backgroundColor = UIColor(Palette.console)
        tabBar.shadowColor = UIColor(Palette.consoleBorder)
        apply(to: tabBar.stackedLayoutAppearance)
        apply(to: tabBar.inlineLayoutAppearance)
        apply(to: tabBar.compactInlineLayoutAppearance)
        UITabBar.appearance().standardAppearance = tabBar
        UITabBar.appearance().scrollEdgeAppearance = tabBar
        #endif
    }

    #if canImport(UIKit)
    private static func apply(to appearance: UITabBarItemAppearance) {
        appearance.normal.iconColor = UIColor(Palette.consoleMuted)
        appearance.normal.titleTextAttributes = titleAttributes(Palette.consoleMuted)
        // The chassis is charcoal in BOTH appearances, so the selected tab
        // wears `consoleAccent` rather than the content palette's interaction
        // colour: the light orange measures 2.26:1 on `consoleSelected`, well
        // under what a ten-point label needs. See `FieldConsole.consoleAccent`.
        appearance.selected.iconColor = UIColor(Palette.consoleAccent)
        appearance.selected.titleTextAttributes = titleAttributes(Palette.consoleAccent)
    }

    private static func titleAttributes(_ color: Color) -> [NSAttributedString.Key: Any] {
        var attributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: UIColor(color),
            .kern: 0.9,
        ]
        // The one place in this codebase that names a `UIFont`, because
        // `UITabBarItemAppearance` takes attributed-string attributes and
        // there is no SwiftUI equivalent. It still goes through `UIFontMetrics`
        // so the label grows with the reader's text size — a bare
        // `UIFont(name:size:)` here would be the one fixed font in the app.
        if let plex = UIFont(name: FontFace.monoMedium.postScriptName, size: TypeScale.label) {
            attributes[.font] = UIFontMetrics(forTextStyle: .caption2).scaledFont(for: plex)
        }
        return attributes
    }
    #endif
}
