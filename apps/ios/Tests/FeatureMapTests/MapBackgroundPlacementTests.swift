import CoreDomain
import CoreGraphics
import Testing

@testable import FeatureMap

/// The background placement math — the Swift port of the web's
/// `background-fit.ts`/`background-placement.ts`, exercised over the same
/// cases their own test files pin.
@Suite("Background placement")
struct MapBackgroundPlacementTests {
    /// 10 screen points per metre, local origin at screen (100, 200).
    private let viewport = MapViewportTransform(scale: 10, origin: CGPoint(x: 100, y: 200))

    @Test("geometryScreenRect flips the y axis: local maxY is the screen top")
    func screenRectFlipsY() throws {
        let geometry = Geometry.polygon([[
            Position(x: 0, y: 0), Position(x: 4, y: 0), Position(x: 4, y: 2),
            Position(x: 0, y: 2), Position(x: 0, y: 0),
        ]])

        let rect = try #require(MapBackgroundPlacement.geometryScreenRect(geometry, transform: viewport))

        #expect(rect == CGRect(x: 100, y: 180, width: 40, height: 20))
    }

    @Test("containFitRect letterboxes a wide image inside a tall box, centered")
    func containFitWideImage() {
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 200)
        let fit = MapBackgroundPlacement.containFitRect(bounds: bounds, imageAspect: 2)

        #expect(fit == CGRect(x: 0, y: 75, width: 100, height: 50))
    }

    @Test("containFitRect pillarboxes a tall image inside a wide box, centered")
    func containFitTallImage() {
        let bounds = CGRect(x: 10, y: 10, width: 200, height: 100)
        let fit = MapBackgroundPlacement.containFitRect(bounds: bounds, imageAspect: 0.5)

        #expect(fit == CGRect(x: 85, y: 10, width: 50, height: 100))
    }

    @Test("containFitRect returns degenerate bounds unchanged")
    func containFitDegenerate() {
        let empty = CGRect(x: 5, y: 5, width: 0, height: 10)
        #expect(MapBackgroundPlacement.containFitRect(bounds: empty, imageAspect: 1) == empty)

        let bounds = CGRect(x: 0, y: 0, width: 10, height: 10)
        #expect(MapBackgroundPlacement.containFitRect(bounds: bounds, imageAspect: 0) == bounds)
    }

    @Test("calibratedImagePlacement puts the plan's top-left at the transform's translation")
    func calibratedPlacement() {
        let planTransform = PlanTransform(
            metresPerPlanUnit: 20,
            rotationRadians: 0.5,
            translationMetres: PlanTranslation(x: 3, y: 4)
        )

        let placement = MapBackgroundPlacement.calibratedImagePlacement(
            planTransform: planTransform, pageAspectRatio: 0.75, transform: viewport
        )

        // Local (3, 4) -> screen (100 + 30, 200 - 40).
        #expect(placement.topLeft == CGPoint(x: 130, y: 160))
        #expect(placement.width == 200)
        #expect(placement.height == 150)
        // Local counter-clockwise reads clockwise on the y-down screen.
        #expect(placement.rotationRadians == -0.5)
    }

    @Test("Transform picking inverts drawing: a plan point returns to itself")
    func transformPickingRoundTrips() {
        let planTransform = PlanTransform(
            metresPerPlanUnit: 12,
            rotationRadians: 0.7,
            translationMetres: PlanTranslation(x: -5, y: 9)
        )
        let planPoint = Position(x: 0.4, y: 0.3)

        let local = applyPlanTransform(planTransform, to: planPoint)
        let screen = viewport.screenPoint(for: local)
        let picked = MapBackgroundPlacement.planPoint(
            atScreen: screen, planTransform: planTransform, transform: viewport
        )

        #expect(abs(picked.x - planPoint.x) < 1e-9)
        #expect(abs(picked.y - planPoint.y) < 1e-9)
    }

    @Test("Contain-fit picking divides both axes by the drawn width")
    func containFitPicking() {
        let fit = CGRect(x: 100, y: 50, width: 200, height: 150)

        let topLeft = MapBackgroundPlacement.planPoint(atScreen: CGPoint(x: 100, y: 50), containFit: fit)
        #expect(topLeft == Position(x: 0, y: 0))

        let bottomRight = MapBackgroundPlacement.planPoint(atScreen: CGPoint(x: 300, y: 200), containFit: fit)
        #expect(bottomRight == Position(x: 1, y: 0.75))
    }

    @Test("isPlanPointOnPage bounds u by 1 and v by the aspect ratio")
    func onPageCheck() {
        #expect(MapBackgroundPlacement.isPlanPointOnPage(Position(x: 0.5, y: 0.5), pageAspectRatio: 0.75))
        #expect(!MapBackgroundPlacement.isPlanPointOnPage(Position(x: 1.1, y: 0.5), pageAspectRatio: 0.75))
        #expect(!MapBackgroundPlacement.isPlanPointOnPage(Position(x: 0.5, y: 0.8), pageAspectRatio: 0.75))
        #expect(!MapBackgroundPlacement.isPlanPointOnPage(Position(x: -0.01, y: 0), pageAspectRatio: 0.75))
    }

    @Test("footprintCenter is the page rectangle's midpoint through the transform")
    func footprintCenterIsMidpoint() {
        let planTransform = PlanTransform(
            metresPerPlanUnit: 20,
            rotationRadians: 0,
            translationMetres: PlanTranslation(x: 0, y: 0)
        )
        let center = MapBackgroundPlacement.footprintCenter(
            planTransform: planTransform, pageAspectRatio: 0.75
        )

        // (0.5, 0.375) plan -> (10, -7.5) local (y flips down to up).
        #expect(center == Position(x: 10, y: -7.5))
    }
}
