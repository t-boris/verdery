import CoreDesignSystem

/// One foreground-on-background pairing the design system permits, and the
/// threshold it has to clear.
///
/// Named rather than anonymous so a failure says which two tokens disagreed
/// instead of printing two hex numbers.
struct ContrastPair: Sendable, CustomStringConvertible {
    /// WCAG 2.2 SC 1.4.3: normal-size body text.
    static let aaText = 4.5
    /// WCAG 2.2 SC 1.4.3: text at 24px, or 18.66px bold, and above.
    static let aaLargeText = 3.0
    /// WCAG 2.2 SC 1.4.11: the visual boundary of a control, and meaningful graphics.
    static let aaNonText = 3.0

    let foregroundName: String
    let foreground: TokenColor
    let backgroundName: String
    let background: TokenColor
    let threshold: Double

    var description: String { "\(foregroundName) on \(backgroundName)" }

    init(
        _ foregroundName: String,
        _ foreground: TokenColor,
        on backgroundName: String,
        _ background: TokenColor,
        clears threshold: Double
    ) {
        self.foregroundName = foregroundName
        self.foreground = foreground
        self.backgroundName = backgroundName
        self.background = background
        self.threshold = threshold
    }
}

extension ContrastPair {
    /// Every surface a token-coloured element is ever painted on.
    ///
    /// One more than the web checks: `--color-surface-raised` is a real
    /// surface on iOS, where a raised card is the dominant layout primitive,
    /// whereas the web reserves it for a handful of panels.
    static let surfaces: [(String, TokenColor)] = [
        ("canvas", FieldConsole.canvas),
        ("surface", FieldConsole.surface),
        ("surfaceSunken", FieldConsole.surfaceSunken),
        ("surfaceRaised", FieldConsole.surfaceRaised),
    ]

    /// The chassis surfaces. Checked separately because they are charcoal in
    /// both appearances, so pairing them with the content palette's ink would
    /// measure a combination no screen ever renders.
    static let consoleSurfaces: [(String, TokenColor)] = [
        ("console", FieldConsole.console),
        ("consoleElevated", FieldConsole.consoleElevated),
        ("consoleSelected", FieldConsole.consoleSelected),
    ]

    static let all: [ContrastPair] =
        surfaces.flatMap { name, surface in
            [
                ContrastPair("text", FieldConsole.text, on: name, surface, clears: aaText),
                ContrastPair("textMuted", FieldConsole.textMuted, on: name, surface, clears: aaText),
                ContrastPair("accent", FieldConsole.accent, on: name, surface, clears: aaText),
                ContrastPair("positive", FieldConsole.positive, on: name, surface, clears: aaText),
                ContrastPair("negative", FieldConsole.negative, on: name, surface, clears: aaText),
                ContrastPair("warning", FieldConsole.warning, on: name, surface, clears: aaText),
                // A control's boundary is the only thing identifying it as a control.
                ContrastPair(
                    "controlBorder", FieldConsole.controlBorder, on: name, surface, clears: aaNonText
                ),
                // The focus ring must be visible wherever focus can land.
                ContrastPair("focus", FieldConsole.focus, on: name, surface, clears: aaNonText),
            ]
        }
        + consoleSurfaces.flatMap { name, surface in
            [
                ContrastPair(
                    "consoleText", FieldConsole.consoleText, on: name, surface, clears: aaText
                ),
                ContrastPair(
                    "consoleMuted", FieldConsole.consoleMuted, on: name, surface, clears: aaText
                ),
                // The chassis carries the one orange signal too — a selected
                // tab, the sync strip's attention state — but through its own
                // token, because the content palette's light accent is
                // unreadable on charcoal. See `FieldConsole.consoleAccent`.
                ContrastPair(
                    "consoleAccent", FieldConsole.consoleAccent, on: name, surface, clears: aaText
                ),
            ]
        }
        + [
            // Text on a filled control.
            ContrastPair(
                "accentText", FieldConsole.accentText, on: "accent", FieldConsole.accent,
                clears: aaText
            ),
            ContrastPair(
                "accentText", FieldConsole.accentText, on: "accentPressed",
                FieldConsole.accentPressed, clears: aaLargeText
            ),

            // Text on the quiet tone washes.
            ContrastPair(
                "text", FieldConsole.text, on: "accentQuiet", FieldConsole.accentQuiet,
                clears: aaText
            ),
            ContrastPair(
                "textMuted", FieldConsole.textMuted, on: "accentQuiet", FieldConsole.accentQuiet,
                clears: aaText
            ),
            ContrastPair(
                "accent", FieldConsole.accent, on: "accentQuiet", FieldConsole.accentQuiet,
                clears: aaText
            ),
            ContrastPair(
                "text", FieldConsole.text, on: "positiveQuiet", FieldConsole.positiveQuiet,
                clears: aaText
            ),
            ContrastPair(
                "positive", FieldConsole.positive, on: "positiveQuiet", FieldConsole.positiveQuiet,
                clears: aaText
            ),
            ContrastPair(
                "text", FieldConsole.text, on: "negativeQuiet", FieldConsole.negativeQuiet,
                clears: aaText
            ),
            ContrastPair(
                "negative", FieldConsole.negative, on: "negativeQuiet", FieldConsole.negativeQuiet,
                clears: aaText
            ),
            ContrastPair(
                "text", FieldConsole.text, on: "warningQuiet", FieldConsole.warningQuiet,
                clears: aaText
            ),
            ContrastPair(
                "warning", FieldConsole.warning, on: "warningQuiet", FieldConsole.warningQuiet,
                clears: aaText
            ),
        ]
}
