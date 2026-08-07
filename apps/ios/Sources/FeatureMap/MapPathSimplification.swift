import CoreDomain
import Foundation

/// Reducing a traced path to the vertices that carry its shape.
///
/// A finger dragged across a bed produces hundreds of samples; the bed has a
/// dozen corners. Persisting the rest would put them on the wire, in the
/// database, and under the fingertips of whoever next edits that shape.
///
/// Douglas–Peucker, with its tolerance taken from ADR-0010's own maximum chord
/// deviation rather than chosen by feel. That number is already the contract
/// for how far a densified curve may sit from the curve it approximates — the
/// same question this asks — so a traced edge simplified to it is exactly as
/// faithful as a stored curve is required to be.
enum MapPathSimplification {
    static func simplified(_ points: [Position], toleranceMetres: Double) -> [Position] {
        guard points.count > 2, toleranceMetres > 0 else { return points }

        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        mark(points, from: 0, to: points.count - 1, tolerance: toleranceMetres, keep: &keep)

        return zip(points, keep).compactMap { $1 ? $0 : nil }
    }

    /// Iterative rather than recursive: a traced path can be thousands of
    /// samples long, and a recursive implementation would be at the mercy of
    /// the stack for a shape somebody drew slowly.
    private static func mark(
        _ points: [Position],
        from first: Int,
        to last: Int,
        tolerance: Double,
        keep: inout [Bool]
    ) {
        var stack: [(Int, Int)] = [(first, last)]

        while let (start, end) = stack.popLast() {
            guard end > start + 1 else { continue }

            var farthest = start
            var greatest = 0.0
            for index in (start + 1)..<end {
                let distance = perpendicularDistance(
                    points[index], from: points[start], to: points[end]
                )
                if distance > greatest {
                    greatest = distance
                    farthest = index
                }
            }

            guard greatest > tolerance else { continue }
            keep[farthest] = true
            stack.append((start, farthest))
            stack.append((farthest, end))
        }
    }

    private static func perpendicularDistance(
        _ point: Position,
        from start: Position,
        to end: Position
    ) -> Double {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let lengthSquared = dx * dx + dy * dy

        // A degenerate segment — the path doubled back on itself — has no
        // perpendicular, so the distance is to the point they share.
        guard lengthSquared > 0 else {
            return hypot(point.x - start.x, point.y - start.y)
        }

        let cross = abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
        return cross / sqrt(lengthSquared)
    }
}
