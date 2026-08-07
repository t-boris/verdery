import CoreDomain
import Foundation

/// A shape being drawn, before it becomes an object.
///
/// This is the largest parity gap in the product, and the owner's own
/// requirement — "drag a finger to draw areas" — is the same item.
/// `MapGestureCommands.defaultGeometry` places a fixed four-metre square at
/// the tap point and its own doc comment says freehand creation "remains out
/// of scope", so every lot, house, bed and path on this client is a square
/// somebody then reshaped vertex by vertex. The web has had real multi-point
/// drafting since Phase 3.
///
/// Two ways in, both feeding the same draft: **tapping** places one vertex at
/// a time, and **dragging** traces freehand. Mixing them within one shape is
/// allowed and expected — trace a curved bed edge, then tap the three straight
/// corners.
///
/// Pure and free of SwiftUI, like every other helper in this feature, so the
/// rules below can be argued in a test rather than in a simulator.
public struct MapDraftSession: Sendable, Equatable {
    public let category: CreatableMapObjectCategory
    public private(set) var points: [Position]

    public init(category: CreatableMapObjectCategory, points: [Position] = []) {
        self.category = category
        self.points = points
    }

    /// What shape this category draws.
    public enum Kind: Sendable, Equatable {
        case point
        case line
        case ring
    }

    public var kind: Kind {
        switch category {
        case .tree, .plant, .annotation: .point
        case .fence, .path, .gate: .line
        case .lot, .structure, .zone, .bed, .waterFeature, .utilityExclusion: .ring
        }
    }

    /// The fewest points this shape can be finished with.
    ///
    /// Three for a ring rather than four: the closing vertex is added on
    /// finish rather than asked for, because nobody drawing a triangle thinks
    /// of it as four points.
    public var minimumPointCount: Int {
        switch kind {
        case .point: 1
        case .line: 2
        case .ring: 3
        }
    }

    public var canFinish: Bool { points.count >= minimumPointCount }

    // MARK: - Building

    public mutating func addPoint(_ point: Position) {
        // A point shape holds exactly one: tapping again moves it rather than
        // starting a second, which is what somebody correcting their aim
        // means.
        if kind == .point {
            points = [point]
        } else {
            points.append(point)
        }
    }

    public mutating func undoLastPoint() {
        guard !points.isEmpty else { return }
        points.removeLast()
    }

    /// Appends a traced path, simplified.
    ///
    /// A finger produces hundreds of samples for a shape that needs a dozen
    /// vertices, and every one of them would be persisted, synchronised, and
    /// dragged around by anybody who later edited it.
    public mutating func addTracedPath(
        _ traced: [Position],
        toleranceMetres: Double = GeometryTolerances.maximumChordDeviationMetres
    ) {
        let simplified = MapPathSimplification.simplified(traced, toleranceMetres: toleranceMetres)
        for point in simplified {
            // The coalescing epsilon, so a slow finger cannot emit two
            // vertices a tenth of a millimetre apart.
            if let last = points.last,
                hypot(point.x - last.x, point.y - last.y)
                    < GeometryTolerances.vertexEpsilonMetres
            {
                continue
            }
            points.append(point)
        }
    }

    // MARK: - Finishing

    /// The geometry this draft became, or `nil` when it is not finishable.
    ///
    /// The closing vertex of a ring is added here rather than collected,
    /// matching what `GeometryValidation` expects and what the web's own
    /// drafting does.
    public func geometry() -> Geometry? {
        guard canFinish else { return nil }

        switch kind {
        case .point:
            guard let first = points.first else { return nil }
            return .point(first)
        case .line:
            return .lineString(points)
        case .ring:
            var ring = points
            if let first = points.first, ring.last != first {
                ring.append(first)
            }
            return .polygon([ring])
        }
    }
}
