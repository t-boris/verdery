import SwiftUI

/// The application's colour palette, as SwiftUI `Color`s.
///
/// A thin semantic layer over ``FieldConsole``, which holds the values. The
/// split is deliberate: `FieldConsole` is the token *table*, readable as
/// numbers so `CoreDesignSystemTests` can prove every pairing clears WCAG;
/// `Palette` is what a view says out loud. Nothing here computes a colour, so
/// a palette change is a change in one table and nowhere else.
///
/// Colours resolve per trait collection rather than being baked, so no screen
/// branches on `colorScheme` itself.
///
/// # What changed from the previous palette, and why nothing changed silently
///
/// This was the "botanical ledger" language — warm paper, fir green, and one
/// literal serving as both `accent` and `positive`. Field Console separates
/// those: orange is what you can act on, green is what is well. Re-pointing
/// `accent` at the orange would have repainted thirty call sites, nine of them
/// decorative medallion discs, without a single compiler error. So `accent` is
/// *gone* rather than re-valued, and the interaction colour has a name that
/// says what it is — ``interaction``. Every former call site had to be read and
/// re-answered. `info` and `infoQuiet` are gone for the same reason: Field
/// Console has no blue, and "here is a fact" is ``textMuted`` on a neutral
/// surface.
///
/// Source: apps/web/shared/ui/tokens.css;
/// architecture/web-application-design.md, section "5. Application Structure".
public enum Palette {
    // MARK: - Surfaces

    public static var canvas: Color { FieldConsole.canvas.color }
    public static var surface: Color { FieldConsole.surface.color }
    public static var surfaceSunken: Color { FieldConsole.surfaceSunken.color }
    public static var surfaceRaised: Color { FieldConsole.surfaceRaised.color }
    public static var surfacePressed: Color { FieldConsole.surfacePressed.color }

    /// The decorative hairline between two blocks of content. Deliberately
    /// below the 3:1 non-text threshold — a control must never reach for it.
    /// Use ``controlBorder`` for anything a reader has to identify as a control.
    public static var border: Color { FieldConsole.border.color }
    public static var borderStrong: Color { FieldConsole.borderStrong.color }
    public static var controlBorder: Color { FieldConsole.controlBorder.color }

    /// The metre grid over the work surface.
    public static var grid: Color { FieldConsole.grid.color }

    // MARK: - Ink

    public static var text: Color { FieldConsole.text.color }
    public static var textMuted: Color { FieldConsole.textMuted.color }

    // MARK: - Interaction

    /// The one signal colour: this is something you can act on.
    ///
    /// Never a status. A finished task is ``positive`` and stays green; an
    /// orange chip means "tap me", and if everything is orange nothing is.
    public static var interaction: Color { FieldConsole.accent.color }
    public static var interactionPressed: Color { FieldConsole.accentPressed.color }
    public static var interactionText: Color { FieldConsole.accentText.color }
    public static var interactionQuiet: Color { FieldConsole.accentQuiet.color }
    public static var interactionQuietBorder: Color { FieldConsole.accentQuietBorder.color }
    public static var interactionGlow: Color { FieldConsole.accentGlow.color }

    public static var focus: Color { FieldConsole.focus.color }

    // MARK: - Tones

    public static var positive: Color { FieldConsole.positive.color }
    public static var positiveQuiet: Color { FieldConsole.positiveQuiet.color }
    public static var positiveQuietBorder: Color { FieldConsole.positiveQuietBorder.color }
    public static var negative: Color { FieldConsole.negative.color }
    public static var negativeQuiet: Color { FieldConsole.negativeQuiet.color }
    public static var negativeQuietBorder: Color { FieldConsole.negativeQuietBorder.color }
    public static var warning: Color { FieldConsole.warning.color }
    public static var warningQuiet: Color { FieldConsole.warningQuiet.color }
    public static var warningQuietBorder: Color { FieldConsole.warningQuietBorder.color }

    // MARK: - Console chrome

    /// The persistent chassis, charcoal in both appearances. A foreground on
    /// it is always ``consoleText``, ``consoleMuted``, or ``consoleAccent`` —
    /// never a content-palette ink, which is chosen against paper.
    public static var console: Color { FieldConsole.console.color }
    public static var consoleElevated: Color { FieldConsole.consoleElevated.color }
    public static var consoleSelected: Color { FieldConsole.consoleSelected.color }
    public static var consoleBorder: Color { FieldConsole.consoleBorder.color }
    public static var consoleText: Color { FieldConsole.consoleText.color }
    public static var consoleMuted: Color { FieldConsole.consoleMuted.color }
    public static var consoleAccent: Color { FieldConsole.consoleAccent.color }
}
