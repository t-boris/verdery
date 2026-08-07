import CoreDesignSystem
import Testing

/// The spacing, radius and motion steps, asserted as values.
///
/// These numbers come from `apps/web/shared/ui/tokens.css` and are the only
/// thing keeping the two clients on one rhythm. A step edited by eye — to make
/// one screen sit better — is invisible in review and permanent in the
/// product, so the table is written down twice.
@Suite("Metrics and motion")
struct MetricsTests {
    @Test("keeps the spacing scale on the web's steps")
    func spacingScale() {
        #expect(
            [
                Metrics.space1, Metrics.space2, Metrics.space3, Metrics.space4,
                Metrics.space5, Metrics.space6, Metrics.space7, Metrics.space8,
            ] == [4, 8, 12, 16, 24, 32, 48, 64]
        )
    }

    /// Named for what they wrap, and ordered: a control's corner is tighter
    /// than a card's, a card's than a sheet's. If that order ever inverts, one
    /// of them was chosen for a screen rather than from the scale.
    @Test("keeps radii on the web's steps, tightest first")
    func radiusScale() {
        #expect(Metrics.radiusSmall == 4)
        #expect(Metrics.radiusControl == 6)
        #expect(Metrics.radiusCard == 10)
        #expect(Metrics.radiusSheet == 14)
        #expect(Metrics.radiusPill == 999)
        #expect(Metrics.radiusSmall < Metrics.radiusControl)
        #expect(Metrics.radiusControl < Metrics.radiusCard)
        #expect(Metrics.radiusCard < Metrics.radiusSheet)
    }

    /// 44 points, unconditionally. The web token relaxes to 32 for a fine
    /// pointer on a wide viewport; there is no such case here, and this
    /// product's outdoor-use requirement is measured against the larger number.
    @Test("holds the touch target at the outdoor minimum")
    func touchTarget() {
        #expect(Metrics.minimumTouchTarget == 44)
    }

    @Test("matches the web's two durations")
    func motionDurations() {
        #expect(Metrics.hairline == 1)
        #expect(Motion.fast == 0.12)
        #expect(Motion.medium == 0.22)
    }

    /// The whole reason the helpers take the flag: Reduce Motion must produce
    /// an instant change, not a quicker one. A `nil` animation is how SwiftUI
    /// spells that, so this asserts the contract every animated view relies on.
    @Test("returns no animation at all under Reduce Motion")
    func reduceMotionSuppressesAnimation() {
        #expect(Motion.quick(true) == nil)
        #expect(Motion.settle(true) == nil)
        #expect(Motion.quick(false) != nil)
        #expect(Motion.settle(false) != nil)
    }
}
