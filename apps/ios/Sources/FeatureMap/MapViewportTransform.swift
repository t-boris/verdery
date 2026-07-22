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

    public static let minimumScale = 1.0
    public static let maximumScale = 400.0

    public init(scale: Double, origin: CGPoint) {
        self.scale = scale.isFinite ? scale.clamped(to: Self.minimumScale...Self.maximumScale) : Self.minimumScale
        self.origin = origin
    }

    /// A transform that fits `bounds` centred in `viewportSize`, with a
    /// margin on every side. Used once per load, when the document's content
    /// bounds and the canvas's on-screen size both become known; pan and zoom
    /// gestures move away from this starting point afterward.
    public static func fitting(
        bounds: MapContentBounds,
        viewportSize: CGSize,
        marginFraction: Double = 0.1
    ) -> MapViewportTransform {
        guard viewportSize.width > 0, viewportSize.height > 0 else {
            return MapViewportTransform(scale: minimumScale, origin: .zero)
        }

        let contentWidth = max(bounds.width, GeometryTolerances.minimumLineLengthMetres)
        let contentHeight = max(bounds.height, GeometryTolerances.minimumLineLengthMetres)
        let margin = 1 - (marginFraction * 2)
        let scaleToFitWidth = (Double(viewportSize.width) * margin) / contentWidth
        let scaleToFitHeight = (Double(viewportSize.height) * margin) / contentHeight
        let scale = min(scaleToFitWidth, scaleToFitHeight)

        let centerLocal = bounds.center
        let origin = CGPoint(
            x: Double(viewportSize.width) / 2 - centerLocal.x * scale,
            y: Double(viewportSize.height) / 2 + centerLocal.y * scale
        )

        return MapViewportTransform(scale: scale, origin: origin)
    }

    /// Converts a garden-local position to a screen point.
    public func screenPoint(for local: Position) -> CGPoint {
        CGPoint(x: origin.x + local.x * scale, y: origin.y - local.y * scale)
    }

    /// Converts a screen point back to a garden-local position — the inverse
    /// of ``screenPoint(for:)``, used to turn a tap or drag endpoint into the
    /// coordinate a command payload carries.
    public func localPosition(for screen: CGPoint) -> Position {
        Position(x: (screen.x - origin.x) / scale, y: (origin.y - screen.y) / scale)
    }

    /// Converts a screen-space distance (a drag translation, a hit-test
    /// tolerance in points) to garden-local metres at the current zoom.
    public func localDistance(forScreenDistance screenDistance: Double) -> Double {
        screenDistance / scale
    }

    /// A new transform panned by a screen-space translation — what a
    /// `DragGesture`'s translation becomes when nothing is selected under the
    /// gesture's start point.
    public func panned(byScreenTranslation translation: CGSize) -> MapViewportTransform {
        MapViewportTransform(
            scale: scale,
            origin: CGPoint(x: origin.x + translation.width, y: origin.y + translation.height)
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

        return MapViewportTransform(
            scale: newScale,
            origin: CGPoint(
                x: anchor.x - (anchor.x - origin.x) * appliedFactor,
                y: anchor.y - (anchor.y - origin.y) * appliedFactor
            )
        )
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
