import SwiftUI

/// The semantic tones a badge, chip, medallion, or status dot can carry.
///
/// A tone says what a *record* is. It never says what you can do — that is
/// ``Palette/interaction``, and keeping the two apart is the whole of the
/// Field Console direction. The previous enum had an `accent` case, and
/// because it was also the default of `Chip`, `IconMedallion`,
/// `CompactActionButton` and the quiet button style, seventeen surfaces were
/// painting themselves with the interaction signal simply by not choosing.
/// Removing the case is what made the compiler ask each of them the question.
///
/// A tone is never only a colour: each one names a fill, a foreground, and a
/// symbol, so a reader who cannot distinguish the hues still reads the state
/// from the shape. The symbol lives here rather than at the call site
/// precisely so that it cannot be forgotten.
///
/// `info` is gone as well. Field Console has no blue, and every former use of
/// it meant "here is a fact", which is ``neutral``.
public enum Tone: Sendable, CaseIterable {
    /// A fact, a category, a piece of furniture. The default.
    case neutral
    /// Something is well, finished, or healthy.
    case positive
    /// Something needs attention but nothing is broken.
    case warning
    /// Something failed, is blocked, or will be destroyed.
    case negative

    public var foreground: Color {
        switch self {
        case .neutral: Palette.textMuted
        case .positive: Palette.positive
        case .warning: Palette.warning
        case .negative: Palette.negative
        }
    }

    public var quietFill: Color {
        switch self {
        case .neutral: Palette.surfaceSunken
        case .positive: Palette.positiveQuiet
        case .warning: Palette.warningQuiet
        case .negative: Palette.negativeQuiet
        }
    }

    public var quietBorder: Color {
        switch self {
        case .neutral: Palette.border
        case .positive: Palette.positiveQuietBorder
        case .warning: Palette.warningQuietBorder
        case .negative: Palette.negativeQuietBorder
        }
    }

    /// The SF Symbol that carries this tone's meaning without colour.
    ///
    /// WCAG 1.4.1: state may not be conveyed by hue alone. Every one of these
    /// is a distinct silhouette, not a recoloured circle, so the four remain
    /// distinguishable in greyscale and to a reader with any form of colour
    /// blindness.
    public var symbol: String {
        switch self {
        case .neutral: "circle"
        case .positive: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .negative: "exclamationmark.octagon.fill"
        }
    }
}
