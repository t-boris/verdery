import SwiftUI

/// The spacing and radius scale, and the one dimension every control obeys.
///
/// These are named steps rather than literals at the call site for the same
/// reason the web tokens are: a rhythm that is applied by name stays a rhythm,
/// and one applied by eye drifts within a release.
///
/// Sizes that wrap text are never taken from here directly — they go through
/// `@ScaledMetric`, so they grow with the reader's text size. See
/// ``ScaledSize`` for the wrapper the screens use, and
/// `Tests/ArchitectureTests/AccessibilityConventionTests.swift` for the rule
/// that keeps it that way.
public enum Metrics {
    // Spacing scale, matching `--space-1` … `--space-8`.
    public static let space1: CGFloat = 4
    public static let space2: CGFloat = 8
    public static let space3: CGFloat = 12
    public static let space4: CGFloat = 16
    public static let space5: CGFloat = 24
    public static let space6: CGFloat = 32
    public static let space7: CGFloat = 48
    public static let space8: CGFloat = 64

    // MARK: - Radii
    //
    // Named for what they wrap rather than by size, which the previous
    // `small`/`medium`/`large`/`extraLarge` scale could not survive: Field
    // Console's control radius is 6 and its card radius is 10, and the old
    // `radiusMedium` was 10. Re-valuing that name would have silently pulled
    // every card in to a control's corner while looking like a no-op. A
    // semantic name also answers the question a call site actually has, which
    // is never "how round" but "what is this".
    //
    // Source: apps/web/shared/ui/tokens.css, `--radius-sm` … `--radius-pill`.

    /// `--radius-sm`. A swatch, a colour dot, a progress bar's cap.
    public static let radiusSmall: CGFloat = 4

    /// `--radius-md`. Buttons, inputs, and anything a finger commits with.
    /// The token file's own note is the argument for keeping it this tight:
    /// "a control reads as a control at 6px".
    public static let radiusControl: CGFloat = 6

    /// `--radius-lg`. Cards, medallions, bounded panels — a surface holding
    /// content rather than a control accepting a tap.
    public static let radiusCard: CGFloat = 10

    /// `--radius-xl`. Sheets and other detached surfaces, whose corner has to
    /// read from across the screen.
    public static let radiusSheet: CGFloat = 14

    /// `--radius-pill`. Chips, capsules, the search strip.
    public static let radiusPill: CGFloat = 999

    // MARK: - Lines and focus

    public static let hairline: CGFloat = 1
    /// `--focus-ring-width` and `--focus-ring-offset`.
    public static let focusRingWidth: CGFloat = 3
    public static let focusRingOffset: CGFloat = 2

    // MARK: - The chassis

    /// `--console-mobile-nav-size`. The tab bar's own height.
    public static let consoleChassisHeight: CGFloat = 56
    /// `--shell-status-size`. The permanent status strip above it.
    public static let statusStripHeight: CGFloat = 24

    /// The minimum width and height of any standalone control.
    ///
    /// 44 points is what WCAG 2.2 SC 2.5.5 asks for and what this product's
    /// own "touch targets and map controls must remain usable outdoors"
    /// requirement is measured against. A dense, icon-led layout draws the
    /// *symbol* smaller than this; it never draws the *target* smaller.
    ///
    /// The web token this mirrors relaxes to 32 for a fine pointer on a wide
    /// viewport. There is no such case here: every pointer is a fingertip.
    public static let minimumTouchTarget: CGFloat = 44

    /// Symbols are deliberately absent from this table.
    ///
    /// An SF Symbol is sized by the text style it is given plus `imageScale`,
    /// never by a point size: sized that way it tracks the reader's text-size
    /// setting and sits on the adjacent label's baseline, and sized by a number
    /// it does neither. `Tests/ArchitectureTests/AccessibilityConventionTests
    /// .swift` enforces this — an earlier draft of this design system passed a
    /// `@ScaledMetric` value into `.font(.system(size:))`, which does scale but
    /// still loses the baseline alignment, and the rule caught it.
}

/// A dimension that grows with the reader's text size.
///
/// A property wrapper rather than a bare constant because a fixed frame around
/// text clips it at accessibility sizes just as surely as a fixed font would.
/// Declaring `@ScaledSize(Metrics.minimumTouchTarget) private var disc` reads as
/// one line and is scaled for free.
@propertyWrapper
public struct ScaledSize: DynamicProperty {
    @ScaledMetric private var value: CGFloat

    public init(_ base: CGFloat, relativeTo textStyle: Font.TextStyle = .body) {
        _value = ScaledMetric(wrappedValue: base, relativeTo: textStyle)
    }

    public var wrappedValue: CGFloat { value }
}
