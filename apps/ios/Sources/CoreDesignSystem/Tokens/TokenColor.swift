import SwiftUI

/// One design token's colour, as the pair of values it actually is.
///
/// The previous `Palette` returned an opaque `SwiftUI.Color` built inside a
/// `UIColor` trait closure. That is the right thing to *render*, but it throws
/// the numbers away: nothing outside the closure can read what the token
/// resolves to, so the contrast guarantee the palette is chosen for could not
/// be asserted anywhere. `apps/web/shared/ui/contrast.test.ts` fails the web
/// build when a token pair drops below its WCAG threshold, and it can do that
/// only because the values are readable — it parses them back out of
/// `tokens.css`. This type is what gives the Swift side the same ability:
/// ``light`` and ``dark`` stay visible, and ``color`` is derived from them.
///
/// Colours resolve per trait collection rather than being baked, so no screen
/// ever branches on `colorScheme` itself.
///
/// Source: architecture/web-application-design.md, section "14. Accessibility";
/// apps/web/shared/ui/tokens.css.
public struct TokenColor: Sendable, Equatable {
    /// The light-appearance value, as `0xRRGGBB`.
    public let light: UInt32

    /// The dark-appearance value, as `0xRRGGBB`.
    public let dark: UInt32

    /// Light-appearance alpha. Only two tokens are translucent — the metre
    /// grid and the accent glow — and both are translucent *by design*, so
    /// that what shows through them is the surface they sit on rather than a
    /// second opaque colour that would have to be kept in step with it.
    public let lightOpacity: Double

    /// Dark-appearance alpha. See ``lightOpacity``.
    public let darkOpacity: Double

    public init(
        light: UInt32,
        dark: UInt32,
        lightOpacity: Double = 1,
        darkOpacity: Double = 1
    ) {
        self.light = light
        self.dark = dark
        self.lightOpacity = lightOpacity
        self.darkOpacity = darkOpacity
    }

    /// A colour that resolves itself against the current appearance.
    ///
    /// `#if canImport(UIKit)`: this package also builds headlessly for macOS
    /// so `swift test` runs without a simulator (see `Package.swift`). The
    /// macOS branch resolves to the light value, which is never displayed —
    /// no macOS product ships — but keeps the type checking honest instead of
    /// excluding the whole design system from that build.
    public var color: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(rgb: dark, alpha: darkOpacity)
                    : UIColor(rgb: light, alpha: lightOpacity)
            }
        )
        #else
        Color(rgb: light, alpha: lightOpacity)
        #endif
    }
}

#if canImport(UIKit)
extension UIColor {
    fileprivate convenience init(rgb: UInt32, alpha: Double) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: CGFloat(alpha)
        )
    }
}
#else
extension Color {
    fileprivate init(rgb: UInt32, alpha: Double) {
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255,
            opacity: alpha
        )
    }
}
#endif
