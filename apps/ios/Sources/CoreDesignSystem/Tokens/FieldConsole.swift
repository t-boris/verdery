import SwiftUI

/// The Field Console colour table, one value per custom property in
/// `apps/web/shared/ui/tokens.css`.
///
/// The design language is "Professional Field Console": dense operational
/// surfaces, a charcoal navigation chassis that stays charcoal in both
/// appearances, ONE orange interaction signal, and hairlines rather than
/// elevation doing the separating. Green is reserved for ``positive`` and is
/// never an interaction colour — that separation is the whole point of the
/// direction, and it is the thing the previous "botanical ledger" palette in
/// `Palette.swift` could not express, because there `accent` and `positive`
/// were the same literal.
///
/// Source: apps/web/shared/ui/tokens.css;
/// architecture/web-application-design.md, section "5. Application Structure".
///
/// # How this relates to `Palette`
///
/// This is the table; ``Palette`` is the vocabulary a view speaks. The split
/// exists so the values stay readable as numbers: every pairing here is
/// measured against WCAG by
/// `Tests/CoreDesignSystemTests/FieldConsoleContrastTests.swift`, which is
/// only possible because ``TokenColor`` does not collapse straight to an
/// opaque `Color`. The web palette needed two corrections to pass that same
/// gate, and this one needed ``consoleAccent`` — found by the test, before a
/// single component had been built on top of it.
///
/// Nothing outside `Palette` should name a token here directly.
public enum FieldConsole {
    // MARK: - Surfaces

    public static let canvas = TokenColor(light: 0xF2F0E9, dark: 0x0C100F)
    public static let surface = TokenColor(light: 0xFBFAF6, dark: 0x151B18)
    public static let surfaceSunken = TokenColor(light: 0xE6E4DA, dark: 0x101512)
    public static let surfaceRaised = TokenColor(light: 0xFFFFFF, dark: 0x1D2521)

    /// `--color-surface-hover`, renamed. A touch device has no hover state;
    /// what this value is actually for on iOS is the pressed appearance of a
    /// card or row, which is the same job the web gives it under a pointer.
    public static let surfacePressed = TokenColor(light: 0xEEECE3, dark: 0x253029)

    /// The decorative hairline that separates two blocks of content.
    ///
    /// Deliberately BELOW the 3:1 non-text threshold, and
    /// ``FieldConsoleContrastTests`` asserts that it stays below: the point of
    /// keeping ``controlBorder`` as a separate token is that a control never
    /// reaches for this one.
    public static let border = TokenColor(light: 0xD3D1C4, dark: 0x303B35)
    public static let borderStrong = TokenColor(light: 0xB0AE9D, dark: 0x4C5E54)

    /// The boundary of an interactive control.
    ///
    /// WCAG 2.2 SC 1.4.11 (Non-text Contrast) requires 3:1 against the
    /// adjacent background for "visual information required to identify user
    /// interface components". A text field and a quiet button have no fill of
    /// their own — this hairline IS the whole of that information — so they
    /// cannot use ``border``.
    public static let controlBorder = TokenColor(light: 0x6F6F61, dark: 0x7F9388)

    /// The metre grid across the work surface. Translucent by design: what
    /// shows through is whichever surface it is drawn over.
    public static let grid = TokenColor(
        light: 0x4A534A,
        dark: 0x7E9789,
        lightOpacity: 0.08,
        darkOpacity: 0.07
    )

    public static let accentGlow = TokenColor(
        light: 0xB53D18,
        dark: 0xFF7A59,
        lightOpacity: 0.14,
        darkOpacity: 0.16
    )

    // MARK: - Ink

    public static let text = TokenColor(light: 0x15150F, dark: 0xF0F4F1)
    public static let textMuted = TokenColor(light: 0x66665A, dark: 0x9EADA5)

    // MARK: - The one signal colour: interaction, never success

    public static let accent = TokenColor(light: 0xB53D18, dark: 0xFF7A59)

    /// `--color-accent-active`, renamed for a device with no hover. The web's
    /// `--color-accent-hover` has no iOS counterpart and is not ported.
    public static let accentPressed = TokenColor(light: 0x832B11, dark: 0xE96849)

    public static let accentText = TokenColor(light: 0xFFFFFF, dark: 0x21100B)
    public static let accentQuiet = TokenColor(light: 0xF7E3DC, dark: 0x30211D)
    public static let accentQuietBorder = TokenColor(light: 0xE8C4B6, dark: 0x59372E)

    // MARK: - Tones. State is never carried by the signal colour.

    public static let positive = TokenColor(light: 0x2F6B3F, dark: 0x83D6A3)

    /// Not in `tokens.css`, and deliberately so on that side: the web renders
    /// no green wash, because a completed task there is a row, not a chip.
    /// iOS does render one, so the pair is constructed here by the same rule
    /// the other quiet pairs follow — a tint of the tone light enough to carry
    /// ``text`` at 4.5:1, and a border one step darker than the fill.
    ///
    /// These two belong in `tokens.css` as well, so that one table describes
    /// both clients; that edit is listed in the plan's documentation
    /// obligations rather than made here, because this package cannot reach
    /// across into the web workspace.
    public static let positiveQuiet = TokenColor(light: 0xE2EDE4, dark: 0x1E2C22)
    public static let positiveQuietBorder = TokenColor(light: 0xC4D8C9, dark: 0x2E4636)

    public static let negative = TokenColor(light: 0x96322C, dark: 0xF2A99F)
    public static let negativeQuiet = TokenColor(light: 0xF6E6E2, dark: 0x3A2320)
    public static let negativeQuietBorder = TokenColor(light: 0xE2C5BE, dark: 0x57342F)

    public static let warning = TokenColor(light: 0x6F5312, dark: 0xE3BD77)
    public static let warningQuiet = TokenColor(light: 0xF2EAD6, dark: 0x332A15)
    public static let warningQuietBorder = TokenColor(light: 0xDED0AA, dark: 0x4F4222)

    public static let focus = TokenColor(light: 0xB53D18, dark: 0xF2622F)

    // MARK: - Console chrome

    /// The persistent chassis — tab bar, status strip, sheet head and foot
    /// bars. Charcoal in BOTH appearances: dark mode deepens it rather than
    /// inverting it, which is why these are the one group whose light and dark
    /// values are both dark. Nothing may compute a contrasting foreground for
    /// them; the answer is always ``consoleText`` or ``consoleMuted``.
    public static let console = TokenColor(light: 0x171C18, dark: 0x090D0B)
    public static let consoleElevated = TokenColor(light: 0x222923, dark: 0x121814)
    public static let consoleSelected = TokenColor(light: 0x2B332C, dark: 0x1D2822)
    public static let consoleBorder = TokenColor(light: 0x3A443B, dark: 0x2C3932)
    public static let consoleText = TokenColor(light: 0xF1F3EF, dark: 0xF2F5F3)
    public static let consoleMuted = TokenColor(light: 0xA7B0A7, dark: 0x96A39B)

    /// The interaction signal *on the chassis* — a selected tab, the status
    /// strip's attention state.
    ///
    /// The same value in both appearances, and not a mistake: the chassis is
    /// charcoal in both, so a foreground on it is always a light-on-dark
    /// problem and must not flip with the content palette.
    /// ``consoleText`` and ``consoleMuted`` already behave this way — their
    /// two values differ only by a shade — and this token simply joins that
    /// set instead of pretending the chassis follows the appearance.
    ///
    /// Using ``accent`` here instead was measured and fails: the light
    /// palette's `#B53D18` lands at 3.00:1 on ``console``, 2.59:1 on
    /// ``consoleElevated`` and 2.26:1 on ``consoleSelected``, against the
    /// 4.5:1 a tab label at ten points needs. The web never hit this because
    /// on its chassis the orange is a registration mark on a panel's leading
    /// edge — a non-text graphic held to 3:1 — and never a word.
    public static let consoleAccent = TokenColor(light: 0xFF7A59, dark: 0xFF7A59)
}
