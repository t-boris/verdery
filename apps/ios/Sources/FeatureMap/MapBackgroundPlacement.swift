import CoreDomain
import CoreGraphics

/// Screen-space placement math for an imported background's plan image —
/// the Swift counterpart of the web's `background-fit.ts` (placeholder
/// contain-fit for an UNcalibrated background) and `background-placement.ts`
/// (transform placement for a CALIBRATED one, plus the screen -> plan
/// inverse picking the calibration flow needs). Pure functions over
/// ``MapViewportTransform``, no SwiftUI — testable by `swift test` alone,
/// the same discipline as every other geometry helper in this feature.
public enum MapBackgroundPlacement {
    /// Konva-equivalent placement of the plan image under `transform`: the
    /// screen point the plan's top-left corner (plan-fraction `(0, 0)`)
    /// draws at, the drawn size, and the CLOCKWISE screen rotation. Local
    /// counter-clockwise rotation appears clockwise on the y-down screen,
    /// hence the sign flip.
    public struct CalibratedImagePlacement: Equatable, Sendable {
        public let topLeft: CGPoint
        public let width: Double
        public let height: Double
        public let rotationRadians: Double

        public init(topLeft: CGPoint, width: Double, height: Double, rotationRadians: Double) {
            self.topLeft = topLeft
            self.width = width
            self.height = height
            self.rotationRadians = rotationRadians
        }
    }

    /// The geometry's bounding box as a screen-space rectangle under the
    /// current viewport transform. `nil` for an empty geometry.
    public static func geometryScreenRect(
        _ geometry: Geometry,
        transform: MapViewportTransform
    ) -> CGRect? {
        let positions = geometry.positions
        guard let first = positions.first else { return nil }

        var minX = first.x
        var maxX = first.x
        var minY = first.y
        var maxY = first.y
        for position in positions.dropFirst() {
            minX = min(minX, position.x)
            maxX = max(maxX, position.x)
            minY = min(minY, position.y)
            maxY = max(maxY, position.y)
        }

        // Local Y increases up, screen Y increases down — the box's top-left
        // on screen is (minX, maxY) in local space.
        let topLeft = transform.screenPoint(for: Position(x: minX, y: maxY))
        return CGRect(
            x: topLeft.x,
            y: topLeft.y,
            width: (maxX - minX) * transform.scale,
            height: (maxY - minY) * transform.scale
        )
    }

    /// The largest rectangle of `imageAspect` (width / height) that fits
    /// inside `bounds`, centered — CSS `object-fit: contain` semantics, the
    /// honest rendering for an uncalibrated background: the image's own
    /// proportions are preserved, never stretched to imply the placeholder
    /// polygon's proportions are meaningful.
    public static func containFitRect(bounds: CGRect, imageAspect: Double) -> CGRect {
        guard bounds.width > 0, bounds.height > 0, imageAspect.isFinite, imageAspect > 0 else {
            return bounds
        }

        let boundsAspect = bounds.width / bounds.height
        if imageAspect >= boundsAspect {
            let height = bounds.width / imageAspect
            return CGRect(
                x: bounds.origin.x,
                y: bounds.origin.y + (bounds.height - height) / 2,
                width: bounds.width,
                height: height
            )
        }
        let width = bounds.height * imageAspect
        return CGRect(
            x: bounds.origin.x + (bounds.width - width) / 2,
            y: bounds.origin.y,
            width: width,
            height: bounds.height
        )
    }

    /// Where the plan image draws under `planTransform`: the plan's top-left
    /// corner maps to the transform's translation; one plan unit spans the
    /// page width (`metresPerPlanUnit` metres).
    public static func calibratedImagePlacement(
        planTransform: PlanTransform,
        pageAspectRatio: Double,
        transform: MapViewportTransform
    ) -> CalibratedImagePlacement {
        let topLeft = transform.screenPoint(
            for: applyPlanTransform(planTransform, to: Position(x: 0, y: 0))
        )
        let widthPoints = planTransform.metresPerPlanUnit * transform.scale
        return CalibratedImagePlacement(
            topLeft: topLeft,
            width: widthPoints,
            height: pageAspectRatio * widthPoints,
            rotationRadians: -planTransform.rotationRadians
        )
    }

    /// The plan-fraction point under a screen point, for a background placed
    /// by `planTransform`.
    public static func planPoint(
        atScreen screen: CGPoint,
        planTransform: PlanTransform,
        transform: MapViewportTransform
    ) -> Position {
        planPointForLocal(planTransform, at: transform.localPosition(for: screen))
    }

    /// The plan-fraction point under a screen point for an UNcalibrated
    /// background drawn contain-fit inside `fit`. Both axes divide by the
    /// drawn WIDTH — the plan-fraction convention.
    public static func planPoint(atScreen screen: CGPoint, containFit fit: CGRect) -> Position {
        Position(
            x: (screen.x - fit.origin.x) / fit.width,
            y: (screen.y - fit.origin.y) / fit.width
        )
    }

    /// True when a picked plan point actually lies on the page.
    public static func isPlanPointOnPage(_ point: Position, pageAspectRatio: Double) -> Bool {
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= pageAspectRatio
    }

    /// The footprint's center in local metres — the pivot for orientation
    /// adjustment and placement seeding.
    public static func footprintCenter(
        planTransform: PlanTransform,
        pageAspectRatio: Double
    ) -> Position {
        applyPlanTransform(planTransform, to: Position(x: 0.5, y: pageAspectRatio / 2))
    }
}
