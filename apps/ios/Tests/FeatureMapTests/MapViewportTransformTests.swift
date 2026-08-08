import CoreDomain
import CoreGraphics
import Testing

@testable import FeatureMap

@Suite("Map viewport transform")
struct MapViewportTransformTests {
    @Test("screenPoint and localPosition round-trip")
    func roundTrips() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 200, y: 300))
        let local = Position(x: 4.5, y: -2.25)

        let screen = transform.screenPoint(for: local)
        let recovered = transform.localPosition(for: screen)

        #expect(abs(recovered.x - local.x) < 0.0001)
        #expect(abs(recovered.y - local.y) < 0.0001)
    }

    @Test("Garden-local north (+y) maps to a smaller screen y — screen space grows downward")
    func flipsYAxis() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 0, y: 0))

        let origin = transform.screenPoint(for: Position(x: 0, y: 0))
        let north = transform.screenPoint(for: Position(x: 0, y: 5))

        #expect(north.y < origin.y)
    }

    @Test("localDistance converts a screen distance to metres at the current scale")
    func localDistanceUsesScale() {
        let transform = MapViewportTransform(scale: 20, origin: .zero)

        #expect(transform.localDistance(forScreenDistance: 40) == 2)
    }

    @Test("panned offsets the origin by the screen-space translation")
    func pannedOffsetsOrigin() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 50, y: 50))
        let panned = transform.panned(byScreenTranslation: CGSize(width: 12, height: -8))

        #expect(panned.origin == CGPoint(x: 62, y: 42))
        #expect(panned.scale == transform.scale)
    }

    @Test("zoomed keeps the anchor's garden-local position fixed")
    func zoomedKeepsAnchorFixed() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 100, y: 100))
        let anchor = CGPoint(x: 140, y: 60)
        let localUnderAnchorBefore = transform.localPosition(for: anchor)

        let zoomed = transform.zoomed(by: 2, around: anchor)
        let localUnderAnchorAfter = zoomed.localPosition(for: anchor)

        #expect(abs(localUnderAnchorAfter.x - localUnderAnchorBefore.x) < 0.0001)
        #expect(abs(localUnderAnchorAfter.y - localUnderAnchorBefore.y) < 0.0001)
        #expect(zoomed.scale == 20)
    }

    @Test("zoomed clamps to the minimum scale without breaking the anchor invariant")
    func zoomedClampsMinimum() {
        let transform = MapViewportTransform(scale: MapViewportTransform.minimumScale, origin: .zero)
        let anchor = CGPoint(x: 50, y: 50)

        let zoomed = transform.zoomed(by: 0.1, around: anchor)

        #expect(zoomed.scale == MapViewportTransform.minimumScale)
    }

    @Test("zoomed clamps to the maximum scale")
    func zoomedClampsMaximum() {
        let transform = MapViewportTransform(scale: MapViewportTransform.maximumScale, origin: .zero)
        let zoomed = transform.zoomed(by: 10, around: .zero)

        #expect(zoomed.scale == MapViewportTransform.maximumScale)
    }

    @Test("zoomed ignores a non-finite or non-positive factor")
    func zoomedIgnoresInvalidFactor() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 5, y: 5))

        #expect(transform.zoomed(by: 0, around: .zero) == transform)
        #expect(transform.zoomed(by: -1, around: .zero) == transform)
        #expect(transform.zoomed(by: .nan, around: .zero) == transform)
    }

    @Test("fitting centres content in the viewport")
    func fittingCentresContent() {
        let bounds = MapContentBounds(minX: -5, minY: -5, maxX: 5, maxY: 5)
        let transform = MapViewportTransform.fitting(bounds: bounds, viewportSize: CGSize(width: 200, height: 200))

        let screenCenter = transform.screenPoint(for: bounds.center)

        #expect(abs(screenCenter.x - 100) < 0.01)
        #expect(abs(screenCenter.y - 100) < 0.01)
    }

    @Test("fitting falls back to a sane transform for a zero-size viewport")
    func fittingHandlesZeroViewport() {
        let transform = MapViewportTransform.fitting(bounds: .empty, viewportSize: .zero)

        #expect(transform.scale == MapViewportTransform.minimumScale)
    }

    @Test("MapContentBounds.union grows to include a new position")
    func boundsUnionGrows() {
        let bounds = MapContentBounds(minX: 0, minY: 0, maxX: 1, maxY: 1)
        let grown = bounds.union(Position(x: 5, y: -3))

        #expect(grown.minX == 0)
        #expect(grown.minY == -3)
        #expect(grown.maxX == 5)
        #expect(grown.maxY == 1)
    }

    // MARK: - View rotation

    /// The convention, stated once and pinned: a positive rotation turns the
    /// DRAWING clockwise, so at 90° the garden's local `+Y` — up the canvas
    /// when unrotated — points to the right of the screen.
    ///
    /// This is the web editor's sign, deliberately. The two clients share a
    /// projection and a basemap bearing, and the bearing is the negated sum of
    /// this rotation and the georeference's own; disagreeing here would turn
    /// the photograph the wrong way by twice the angle, which is exactly the
    /// defect the heading already had.
    @Test("a positive rotation turns the drawing clockwise")
    func positiveRotationTurnsClockwise() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 100, y: 100), rotationDegrees: 90)

        let up = transform.screenPoint(for: Position(x: 0, y: 1))

        // Ten points to the RIGHT of the origin, not above it.
        #expect(abs(up.x - 110) < 0.01)
        #expect(abs(up.y - 100) < 0.01)
    }

    @Test("an unrotated transform is unchanged by the rotation term")
    func zeroRotationMatchesTheOldFormula() {
        let transform = MapViewportTransform(scale: 10, origin: CGPoint(x: 50, y: 60))

        let point = transform.screenPoint(for: Position(x: 3, y: 4))

        #expect(abs(point.x - 80) < 0.01)
        #expect(abs(point.y - 20) < 0.01)
    }

    /// Whatever the convention is, the two directions must invert each other —
    /// the same statement `BasemapCameraTests` makes about the projection, and
    /// for the same reason: a hit test that disagrees with the drawing selects
    /// something the finger was not on.
    @Test("screen and local conversions invert each other at every rotation")
    func conversionsRoundTripUnderRotation() {
        for rotation in [0.0, 37.0, 90.0, 213.5, 359.0] {
            let transform = MapViewportTransform(
                scale: 12.5, origin: CGPoint(x: 40, y: 90), rotationDegrees: rotation
            )
            let local = Position(x: 12.5, y: -7.25)

            let back = transform.localPosition(for: transform.screenPoint(for: local))

            #expect(abs(back.x - local.x) < 0.0001, "rotation \(rotation)")
            #expect(abs(back.y - local.y) < 0.0001, "rotation \(rotation)")
        }
    }

    /// A drag translation is not two independent distances. Four call sites
    /// took `width` and `height` through `localDistance` and called them `dx`
    /// and `dy`, which is this function at zero rotation and wrong at any
    /// other — the object would follow the finger while the command recorded a
    /// move along the garden's axes instead.
    @Test("a screen translation becomes the local offset it means")
    func screenTranslationBecomesALocalOffset() {
        let unrotated = MapViewportTransform(scale: 10, origin: .zero)
        let straight = unrotated.localOffset(forScreenTranslation: CGSize(width: 50, height: 30))
        #expect(abs(straight.dx - 5) < 0.0001)
        #expect(abs(straight.dy - (-3)) < 0.0001)

        // Turned a quarter clockwise, dragging RIGHT across the screen moves
        // the object down the garden's own -Y.
        let turned = MapViewportTransform(scale: 10, origin: .zero, rotationDegrees: 90)
        let sideways = turned.localOffset(forScreenTranslation: CGSize(width: 50, height: 0))
        #expect(abs(sideways.dx) < 0.0001)
        #expect(abs(sideways.dy - 5) < 0.0001)
    }

    @Test("rotating holds the garden position under the anchor still")
    func rotatingKeepsTheAnchorFixed() {
        let transform = MapViewportTransform(scale: 15, origin: CGPoint(x: 30, y: 200))
        let anchor = CGPoint(x: 180, y: 140)
        let heldBefore = transform.localPosition(for: anchor)

        let turned = transform.rotated(by: 37, around: anchor)

        let heldAfter = turned.localPosition(for: anchor)
        #expect(abs(heldAfter.x - heldBefore.x) < 0.0001)
        #expect(abs(heldAfter.y - heldBefore.y) < 0.0001)
        #expect(abs(turned.rotationDegrees - 37) < 0.0001)
        #expect(turned.scale == transform.scale)
    }

    @Test("a rotation past a full turn reduces to the turn it looks like")
    func rotationWrapsIntoOneTurn() {
        let transform = MapViewportTransform(scale: 10, origin: .zero, rotationDegrees: 400)
        #expect(abs(transform.rotationDegrees - 40) < 0.0001)

        let backwards = MapViewportTransform(scale: 10, origin: .zero, rotationDegrees: -90)
        #expect(abs(backwards.rotationDegrees - 270) < 0.0001)
    }

    /// A rotated fit measures the box as DRAWN, not the garden's own extent.
    ///
    /// The property is "every corner is on screen and the fit is tight", not a
    /// comparison against the unrotated scale — which way that comparison goes
    /// depends on the shape and the viewport, and asserting a direction taught
    /// this test the wrong thing once already. A 20×4 lot turned 45° into a
    /// square viewport fits LARGER, because its diagonal extent is shorter
    /// than its length.
    @Test("fitting a rotated view fits the rotated bounds")
    func fittingAccountsForRotation() {
        let bounds = MapContentBounds(minX: -10, minY: -2, maxX: 10, maxY: 2)
        let viewport = CGSize(width: 200, height: 200)
        let margin = 0.1

        let diagonal = MapViewportTransform.fitting(
            bounds: bounds, viewportSize: viewport, marginFraction: margin, rotationDegrees: 45
        )

        #expect(abs(diagonal.rotationDegrees - 45) < 0.0001)

        let centre = diagonal.screenPoint(for: bounds.center)
        #expect(abs(centre.x - 100) < 0.01)
        #expect(abs(centre.y - 100) < 0.01)

        let drawn = bounds.corners.map(diagonal.screenPoint(for:))
        for corner in drawn {
            #expect(corner.x >= -0.01 && corner.x <= 200.01, "corner off screen at \(corner)")
            #expect(corner.y >= -0.01 && corner.y <= 200.01, "corner off screen at \(corner)")
        }

        // Tight: the drawn content fills one axis of the margin box exactly,
        // so the fit is the largest one that still shows everything.
        let width = (drawn.map(\.x).max() ?? 0) - (drawn.map(\.x).min() ?? 0)
        let height = (drawn.map(\.y).max() ?? 0) - (drawn.map(\.y).min() ?? 0)
        let available = 200 * (1 - margin * 2)
        #expect(abs(max(width, height) - available) < 0.01)
    }

    @Test("panning and zooming leave the rotation alone")
    func panAndZoomPreserveRotation() {
        let transform = MapViewportTransform(scale: 10, origin: .zero, rotationDegrees: 30)

        #expect(abs(transform.panned(byScreenTranslation: CGSize(width: 5, height: 5)).rotationDegrees - 30) < 0.0001)
        #expect(abs(transform.zoomed(by: 2, around: CGPoint(x: 10, y: 10)).rotationDegrees - 30) < 0.0001)
    }

    /// Zoom keeps its anchor under rotation too. Scaling and rotating about the
    /// same point commute, so `zoomed` needed no rotation term — this is what
    /// says that reasoning was right rather than convenient.
    @Test("zooming holds its anchor still even when the view is turned")
    func zoomKeepsItsAnchorWhenRotated() {
        let transform = MapViewportTransform(scale: 15, origin: CGPoint(x: 30, y: 200), rotationDegrees: 63)
        let anchor = CGPoint(x: 180, y: 140)
        let heldBefore = transform.localPosition(for: anchor)

        let zoomed = transform.zoomed(by: 1.8, around: anchor)

        let heldAfter = zoomed.localPosition(for: anchor)
        #expect(abs(heldAfter.x - heldBefore.x) < 0.0001)
        #expect(abs(heldAfter.y - heldBefore.y) < 0.0001)
    }
}
