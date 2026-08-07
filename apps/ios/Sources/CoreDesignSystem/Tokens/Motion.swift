import SwiftUI

/// The two durations and the one curve the interface animates with.
///
/// Field Console's motion is brief and decorative, never load-bearing: an
/// animation may show that a value changed, and may never be the only thing
/// that says so. Two steps rather than a scale, because a third would be
/// chosen by feel and drift.
///
/// # Why every animation goes through here
///
/// `Tests/ArchitectureTests/AccessibilityConventionTests.swift` fails any file
/// that calls `withAnimation` or `.animation(` without also reading
/// `accessibilityReduceMotion`. Both helpers below take that flag and return
/// `nil` when it is set, which SwiftUI treats as "do not animate" — so honouring
/// the reader's preference is not something a call site can forget to do, it is
/// the only way to call these at all.
///
/// Source: apps/web/shared/ui/tokens.css, `--duration-fast`,
/// `--duration-medium`, `--ease-out`; architecture/ios-application-design.md,
/// section "19. Testing".
public enum Motion {
    /// `--duration-fast`. A selection, a chip filling, a value ticking over.
    public static let fast: Double = 0.12
    /// `--duration-medium`. A sheet detent, a card expanding, a rail moving.
    public static let medium: Double = 0.22

    /// `--ease-out`: `cubic-bezier(0.2, 0, 0, 1)`. Leaves quickly, arrives
    /// gently — the curve that makes a short duration read as responsive
    /// rather than abrupt.
    public static let easeOut = UnitCurve.bezier(
        startControlPoint: UnitPoint(x: 0.2, y: 0),
        endControlPoint: UnitPoint(x: 0, y: 1)
    )

    /// The animation for a state change the reader caused directly.
    ///
    /// Returns `nil` under Reduce Motion, so
    /// `withAnimation(Motion.quick(reduceMotion)) { … }` becomes an
    /// instantaneous change rather than a faster one — which is what the
    /// setting asks for.
    public static func quick(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(easeOut, duration: fast)
    }

    /// The animation for something arriving or resizing on its own.
    public static func settle(_ reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(easeOut, duration: medium)
    }
}
