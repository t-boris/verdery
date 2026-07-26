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
    // Spacing scale, matching `--space-1` … `--space-7`.
    public static let space1: CGFloat = 4
    public static let space2: CGFloat = 8
    public static let space3: CGFloat = 12
    public static let space4: CGFloat = 16
    public static let space5: CGFloat = 24
    public static let space6: CGFloat = 32
    public static let space7: CGFloat = 48

    // Radii, matching `--radius-sm` … `--radius-xl`.
    public static let radiusSmall: CGFloat = 6
    public static let radiusMedium: CGFloat = 10
    public static let radiusLarge: CGFloat = 14
    public static let radiusExtraLarge: CGFloat = 20

    public static let hairline: CGFloat = 1

    /// The minimum width and height of any standalone control.
    ///
    /// 44 points is what WCAG 2.2 SC 2.5.5 asks for and what this product's
    /// own "touch targets and map controls must remain usable outdoors"
    /// requirement is measured against. A dense, icon-led layout draws the
    /// *symbol* smaller than this; it never draws the *target* smaller.
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
