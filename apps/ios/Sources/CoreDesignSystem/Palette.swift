import SwiftUI

/// The application's colour palette.
///
/// Every value here is the iOS counterpart of a custom property in
/// `apps/web/shared/ui/tokens.css`, so the two clients read as one product: a
/// warm paper canvas, deep fir greens, and soft green-tinted elevation — a
/// "botanical ledger" rather than a generic system-grey app.
///
/// Colours are resolved per trait collection rather than baked, so the same
/// token is correct in light and dark without a screen ever branching on
/// `colorScheme` itself. Contrast pairs were carried over from the web
/// palette, where they are checked against WCAG AA by
/// `apps/web/shared/ui/contrast.test.ts`; nothing here carries meaning by
/// colour alone, which is why every tone in ``Tone`` also has a symbol.
public enum Palette {
    // Surfaces.
    public static let canvas = adaptive(light: 0xF2F1E8, dark: 0x10160F)
    public static let surface = adaptive(light: 0xFCFCF7, dark: 0x1A211A)
    public static let surfaceSunken = adaptive(light: 0xECEBDF, dark: 0x141B14)
    public static let border = adaptive(light: 0xD6D4C2, dark: 0x37413A)
    public static let borderStrong = adaptive(light: 0xB5B3A0, dark: 0x4D584F)

    /// The boundary of an interactive control, as distinct from the hairline
    /// that separates two blocks of content. WCAG 2.2 SC 1.4.11 asks for 3:1
    /// against the adjacent background for anything a reader must identify as
    /// a control; ``border`` is well below that and is correct only for
    /// decorative separators.
    public static let controlBorder = adaptive(light: 0x6F7566, dark: 0x7C8A7E)

    // Ink.
    public static let text = adaptive(light: 0x1C2A21, dark: 0xE9EFE7)
    public static let textMuted = adaptive(light: 0x56635A, dark: 0xA9B8AB)

    // Brand green.
    public static let accent = adaptive(light: 0x2F6B3F, dark: 0x7FD0A0)
    public static let accentText = adaptive(light: 0xFFFFFF, dark: 0x0E1710)
    public static let accentQuiet = adaptive(light: 0xE1ECDC, dark: 0x21331F)
    public static let accentQuietBorder = adaptive(light: 0xC2D6BD, dark: 0x35492F)

    // Tones.
    public static let positive = adaptive(light: 0x2F6B3F, dark: 0x7FD0A0)
    public static let positiveQuiet = adaptive(light: 0xE1ECDC, dark: 0x21331F)
    public static let negative = adaptive(light: 0x96322C, dark: 0xF2A99F)
    public static let negativeQuiet = adaptive(light: 0xF7E9E5, dark: 0x3A221F)
    public static let warning = adaptive(light: 0x7A5210, dark: 0xE3BD77)
    public static let warningQuiet = adaptive(light: 0xF5ECD7, dark: 0x35290F)
    public static let info = adaptive(light: 0x2B5566, dark: 0x8FC5DA)
    public static let infoQuiet = adaptive(light: 0xE0EDF2, dark: 0x1B2C33)

    /// Builds a colour that resolves itself against the current appearance.
    ///
    /// `#if canImport(UIKit)`: this package also builds headlessly for macOS
    /// so `swift test` runs without a simulator (see `Package.swift`). The
    /// macOS branch resolves to the light value, which is never displayed —
    /// no macOS product ships — but keeps the type checking honest instead of
    /// excluding the whole design system from that build.
    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
            }
        )
        #else
        Color(rgb: light)
        #endif
    }
}

#if canImport(UIKit)
extension UIColor {
    fileprivate convenience init(rgb: UInt32) {
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}
#else
extension Color {
    fileprivate init(rgb: UInt32) {
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
#endif

/// The semantic tones a badge, chip, or status dot can carry.
///
/// A tone is never only a colour: each one names a fill, a foreground, and —
/// at the call site — a symbol, so that a reader who cannot distinguish the
/// hues still reads the state from the shape.
public enum Tone: Sendable, CaseIterable {
    case neutral
    case accent
    case positive
    case warning
    case negative
    case info

    public var foreground: Color {
        switch self {
        case .neutral: Palette.textMuted
        case .accent: Palette.accent
        case .positive: Palette.positive
        case .warning: Palette.warning
        case .negative: Palette.negative
        case .info: Palette.info
        }
    }

    public var quietFill: Color {
        switch self {
        case .neutral: Palette.surfaceSunken
        case .accent: Palette.accentQuiet
        case .positive: Palette.positiveQuiet
        case .warning: Palette.warningQuiet
        case .negative: Palette.negativeQuiet
        case .info: Palette.infoQuiet
        }
    }
}
