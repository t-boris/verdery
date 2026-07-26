import SwiftUI

/// The type scale.
///
/// Headings use the serif design (New York on Apple platforms), which is what
/// carries the web palette's `--font-family-display` — "a warm old-style
/// serif for headings and the wordmark" — onto iOS without shipping a font
/// file. Body copy stays on the system sans face, exactly as on the web.
///
/// Every entry is built from a semantic `Font.TextStyle`, never a point size:
/// a size written as a number ignores the reader's text-size setting
/// permanently, and that is the first setting most low-vision readers change.
/// `Tests/ArchitectureTests/AccessibilityConventionTests.swift` fails the
/// build if one ever appears.
public enum Typography {
    /// The largest display face — a screen's own name, used once per screen.
    public static let display = Font.system(.largeTitle, design: .serif, weight: .semibold)

    /// A section's name inside a screen.
    public static let title = Font.system(.title2, design: .serif, weight: .semibold)

    /// The name of a single record in a list or a card.
    public static let heading = Font.system(.headline, design: .serif, weight: .semibold)

    /// A small serif line for a card's secondary heading.
    public static let subheading = Font.system(.subheadline, design: .serif, weight: .medium)

    /// Running copy.
    public static let body = Font.body

    /// Supporting copy beneath a heading.
    public static let secondary = Font.subheadline

    /// Metadata: timestamps, counts, chip labels.
    public static let detail = Font.footnote

    /// The smallest supporting text, for a chip's own label.
    public static let micro = Font.caption2

    /// A figure meant to be read as a number rather than as prose — a
    /// priority score, a count. Monospaced digits so a column of them does
    /// not shift as values change.
    public static let metric = Font.system(.title3, design: .rounded, weight: .semibold)
        .monospacedDigit()

    /// An eyebrow above a section: small, letterspaced, uppercase at the call
    /// site.
    public static let eyebrow = Font.caption.weight(.semibold)
}
