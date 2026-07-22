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
}
