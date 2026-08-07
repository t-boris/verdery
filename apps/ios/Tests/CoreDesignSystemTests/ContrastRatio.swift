import CoreDesignSystem
import Foundation

/// WCAG 2.x relative luminance and contrast ratio, over the raw token values.
///
/// A direct port of the arithmetic in `apps/web/shared/ui/contrast.test.ts`, so
/// that a pair measured on one client measures identically on the other. The
/// web reads its numbers back out of `tokens.css`; Swift reads them off
/// ``TokenColor``, which is why that type keeps `light` and `dark` visible
/// rather than collapsing straight to an opaque `Color`.
///
/// Source: WCAG 2.2, "relative luminance" and "contrast ratio" definitions.
enum ContrastRatio {
    /// Which appearance a pair is being measured in.
    enum Appearance: String, Sendable, CaseIterable {
        case light
        case dark

        func value(of token: TokenColor) -> UInt32 {
            switch self {
            case .light: token.light
            case .dark: token.dark
            }
        }
    }

    static func relativeLuminance(_ rgb: UInt32) -> Double {
        let channels = [16, 8, 0].map { shift -> Double in
            let value = Double((rgb >> UInt32(shift)) & 0xFF) / 255
            return value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    static func ratio(_ foreground: UInt32, on background: UInt32) -> Double {
        let first = relativeLuminance(foreground)
        let second = relativeLuminance(background)
        return (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    static func ratio(
        _ foreground: TokenColor,
        on background: TokenColor,
        in appearance: Appearance
    ) -> Double {
        ratio(appearance.value(of: foreground), on: appearance.value(of: background))
    }

    /// Two decimal places, matching the web suite's own rounding so a value
    /// sitting exactly on a threshold is judged the same way on both clients.
    static func rounded(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }
}
