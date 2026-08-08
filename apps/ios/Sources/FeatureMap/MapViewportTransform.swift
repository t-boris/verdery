import CoreDomain
import CoreGraphics

/// The garden-local-metres ↔ screen-points conversion the map editor draws
/// and hit-tests through.
///
/// `Canvas` draws in a screen-space `GraphicsContext`; the domain works in
/// garden-local metres (architecture/map-rendering-and-editing.md, section
/// "3.1"). This is the one place that crosses between the two spaces, kept as
/// a plain value type with no dependency on `Canvas`, `DragGesture`, or any
/// other SwiftUI type, so pan/zoom math is exercised by `swift test` without
/// a running app or a simulator — see the work package's testability
/// requirement.
///
/// `scale` is screen points per metre; `origin` is the screen point that
/// garden-local `(0, 0)` maps to. The `y` axis is flipped between the two
/// spaces: garden-local space is "east, north" (`AxisConvention.xEastYNorth`
/// — north is `+y`), while screen space grows downward (south is `+y`).
public struct MapViewportTransform: Equatable, Sendable {
    /// Screen points per garden-local metre. Always positive; a transform
    /// cannot mirror or collapse the garden.
    public private(set) var scale: Double
    public private(set) var origin: CGPoint
    /// How far the drawing is turned on screen, clockwise, in degrees.
    ///
    /// View rotation, not a property of the garden: "View rotation is part of
    /// the local camera, not an object mutation"
    /// (architecture/map-rendering-and-editing.md, section 3.2). Turning the
    /// view moves no accepted coordinate.
    ///
    /// The convention is the web editor's, to the sign, because the two clients
    /// share a projection and a basemap bearing: `toScreen` there rotates the
    /// local offset by `-rotationDegrees` before drawing it y-up, which makes a
    /// positive angle turn the drawing clockwise. Local `+Y` at 90° therefore
    /// points to the right of the screen, and the backdrop's bearing is the
    /// negated sum of this and the georeference's own rotation.
    public private(set) var rotationDegrees: Double

    public static let minimumScale = 1.0
    public static let maximumScale = 400.0

    public init(scale: Double, origin: CGPoint, rotationDegrees: Double = 0) {
        self.scale = scale.isFinite ? scale.clamped(to: Self.minimumScale...Self.maximumScale) : Self.minimumScale
        self.origin = origin
        self.rotationDegrees = rotationDegrees.isFinite ? rotationDegrees.wrappedIntoOneTurn : 0
    }

    /// `cos` and `sin` of the view rotation, taken once per conversion rather
    /// than per coordinate.
    private var turn: (cosine: Double, sine: Double) {
        let radians = rotationDegrees * .pi / 180
        return (cos(radians), sin(radians))
    }

    /// A transform that fits `bounds` centred in `viewportSize`, with a
    /// margin on every side. Used once per load, when the document's content
    /// bounds and the canvas's on-screen size both become known; pan and zoom
    /// gestures move away from this starting point afterward.
    /// Fits the bounds as they will be DRAWN, which under a view rotation is a
    /// different box from the garden's own extent — wider or narrower
    /// depending on the angle and the shape. A long lot turned 45° in a square
    /// viewport actually needs LESS of each dimension than its own length, and
    /// fits larger; turned into a tall viewport it needs more. Either way,
    /// measuring the unrotated box fits something nobody is looking at.
    public static func fitting(
        bounds: MapContentBounds,
        viewportSize: CGSize,
        marginFraction: Double = 0.1,
        rotationDegrees: Double = 0
    ) -> MapViewportTransform {
        guard viewportSize.width > 0, viewportSize.height > 0 else {
            return MapViewportTransform(scale: minimumScale, origin: .zero, rotationDegrees: rotationDegrees)
        }

        let radians = rotationDegrees * .pi / 180
        let cosine = cos(radians)
        let sine = sin(radians)
        // The same pair `screenPoint(for:)` applies, before scale and origin:
        // one screen point per local metre, in the drawn orientation.
        let drawn = bounds.corners.map { corner in
            (across: corner.x * cosine + corner.y * sine, down: corner.x * sine - corner.y * cosine)
        }

        let minimumExtent = GeometryTolerances.minimumLineLengthMetres
        let contentWidth = max((drawn.map(\.across).max() ?? 0) - (drawn.map(\.across).min() ?? 0), minimumExtent)
        let contentHeight = max((drawn.map(\.down).max() ?? 0) - (drawn.map(\.down).min() ?? 0), minimumExtent)
        let margin = 1 - (marginFraction * 2)
        let scaleToFitWidth = (Double(viewportSize.width) * margin) / contentWidth
        let scaleToFitHeight = (Double(viewportSize.height) * margin) / contentHeight
        let scale = min(scaleToFitWidth, scaleToFitHeight)

        let centre = bounds.center
        let origin = CGPoint(
            x: Double(viewportSize.width) / 2 - scale * (centre.x * cosine + centre.y * sine),
            y: Double(viewportSize.height) / 2 - scale * (centre.x * sine - centre.y * cosine)
        )

        return MapViewportTransform(scale: scale, origin: origin, rotationDegrees: rotationDegrees)
    }

    /// Converts a garden-local position to a screen point.
    ///
    /// `origin` remains the screen point garden-local `(0, 0)` lands on, and
    /// the rotation turns the offset from it. Rotating about a point that may
    /// be off-screen would fling the garden away, so the gesture never rotates
    /// this directly — ``rotated(by:around:)`` moves `origin` to keep a chosen
    /// screen point fixed, exactly as ``zoomed(by:around:)`` already does.
    public func screenPoint(for local: Position) -> CGPoint {
        let (cosine, sine) = turn
        return CGPoint(
            x: origin.x + scale * (local.x * cosine + local.y * sine),
            y: origin.y + scale * (local.x * sine - local.y * cosine)
        )
    }

    /// Converts a screen point back to a garden-local position — the inverse
    /// of ``screenPoint(for:)``, used to turn a tap or drag endpoint into the
    /// coordinate a command payload carries.
    public func localPosition(for screen: CGPoint) -> Position {
        let (cosine, sine) = turn
        let x = (screen.x - origin.x) / scale
        let y = (screen.y - origin.y) / scale
        return Position(x: x * cosine + y * sine, y: x * sine - y * cosine)
    }

    /// Converts a screen-space distance (a hit-test tolerance in points, a
    /// snap radius) to garden-local metres at the current zoom.
    ///
    /// A LENGTH, which rotation does not change — so this stays correct under
    /// any view rotation. A screen *translation* is a different thing and
    /// needs ``localOffset(forScreenTranslation:)``; taking a translation's
    /// width and height through this function and calling them `dx` and `dy`
    /// is only right while the view is unrotated.
    public func localDistance(forScreenDistance screenDistance: Double) -> Double {
        screenDistance / scale
    }

    /// Converts a screen-space drag translation into the garden-local offset
    /// it means.
    ///
    /// Four call sites used to do this by hand as
    /// `dx = localDistance(width)`, `dy = -localDistance(height)`, which is
    /// this function at a rotation of zero and silently wrong at any other —
    /// a drag would move an object along the screen while the command said it
    /// moved along the garden's own axes. The web has had
    /// `screenDeltaToLocalDelta` for exactly this since it gained rotation.
    public func localOffset(forScreenTranslation translation: CGSize) -> PlanarOffset {
        let (cosine, sine) = turn
        let x = Double(translation.width) / scale
        let y = Double(translation.height) / scale
        return PlanarOffset(dx: x * cosine + y * sine, dy: x * sine - y * cosine)
    }

    /// A new transform panned by a screen-space translation — what a
    /// `DragGesture`'s translation becomes when nothing is selected under the
    /// gesture's start point.
    ///
    /// Rotation-independent: a pan moves the whole drawing with the finger, and
    /// `origin` is a screen point.
    public func panned(byScreenTranslation translation: CGSize) -> MapViewportTransform {
        MapViewportTransform(
            scale: scale,
            origin: CGPoint(x: origin.x + translation.width, y: origin.y + translation.height),
            rotationDegrees: rotationDegrees
        )
    }

    /// A new transform turned by `degrees` about a fixed screen anchor, so the
    /// garden position under that point does not move while the view rotates.
    ///
    /// The same shape as ``zoomed(by:around:)`` and for the same reason: the
    /// natural centre of a rotation is the middle of the screen or the middle
    /// of a two-finger gesture, never garden-local `(0, 0)`, which is usually
    /// not even visible.
    public func rotated(by degrees: Double, around anchor: CGPoint) -> MapViewportTransform {
        guard degrees.isFinite else { return self }

        let held = localPosition(for: anchor)
        let turned = MapViewportTransform(
            scale: scale,
            origin: origin,
            rotationDegrees: rotationDegrees + degrees
        )
        let movedTo = turned.screenPoint(for: held)

        return MapViewportTransform(
            scale: scale,
            origin: CGPoint(
                x: turned.origin.x + (anchor.x - movedTo.x),
                y: turned.origin.y + (anchor.y - movedTo.y)
            ),
            rotationDegrees: turned.rotationDegrees
        )
    }

    /// A new transform zoomed by `factor` around a fixed screen anchor (the
    /// pinch gesture's centre), so the garden position under the fingers does
    /// not jump.
    public func zoomed(by factor: Double, around anchor: CGPoint) -> MapViewportTransform {
        guard factor.isFinite, factor > 0 else { return self }

        let newScale = (scale * factor).clamped(to: Self.minimumScale...Self.maximumScale)
        // Re-derive the actually-applied factor after clamping, so the anchor
        // stays fixed even when the requested zoom was clamped away from what
        // the gesture asked for.
        let appliedFactor = newScale / scale

        // Rotation needs no term here. Scaling and rotating about the same
        // point commute: the offset from `origin` is rotated and then scaled,
        // so scaling it by `appliedFactor` scales the rotated offset too.
        return MapViewportTransform(
            scale: newScale,
            origin: CGPoint(
                x: anchor.x - (anchor.x - origin.x) * appliedFactor,
                y: anchor.y - (anchor.y - origin.y) * appliedFactor
            ),
            rotationDegrees: rotationDegrees
        )
    }
}

extension Double {
    /// Reduced into `[0, 360)`, so a rotation that has been nudged past a full
    /// turn compares equal to the one it looks like.
    ///
    /// `[0, 360)` rather than `(-180, 180]` because that is the range the
    /// contract already requires of an accepted georeference rotation, and the
    /// two are added together to point the backdrop.
    fileprivate var wrappedIntoOneTurn: Double {
        let remainder = truncatingRemainder(dividingBy: 360)
        return remainder < 0 ? remainder + 360 : remainder
    }
}

/// The axis-aligned bounding box of a render snapshot's content, in
/// garden-local metres. Used only to compute the initial fit-to-view
/// transform.
public struct MapContentBounds: Equatable, Sendable {
    public let minX: Double
    public let minY: Double
    public let maxX: Double
    public let maxY: Double

    public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
        self.minX = minX
        self.minY = minY
        self.maxX = maxX
        self.maxY = maxY
    }

    /// A small square around the origin, used when a garden has no objects
    /// yet — there is nothing to fit to, but the canvas still needs a sane
    /// starting scale.
    public static let empty = MapContentBounds(minX: -5, minY: -5, maxX: 5, maxY: 5)

    public var width: Double { maxX - minX }
    public var height: Double { maxY - minY }
    public var center: Position { Position(x: (minX + maxX) / 2, y: (minY + maxY) / 2) }

    /// The four corners, which is what a rotated fit has to measure — the
    /// width and height above describe the box only while it is axis-aligned
    /// on screen.
    var corners: [Position] {
        [
            Position(x: minX, y: minY), Position(x: maxX, y: minY),
            Position(x: maxX, y: maxY), Position(x: minX, y: maxY),
        ]
    }

    /// The smallest bounds containing both `self` and `position`.
    func union(_ position: Position) -> MapContentBounds {
        MapContentBounds(
            minX: min(minX, position.x),
            minY: min(minY, position.y),
            maxX: max(maxX, position.x),
            maxY: max(maxY, position.y)
        )
    }
}

extension Comparable {
    fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
