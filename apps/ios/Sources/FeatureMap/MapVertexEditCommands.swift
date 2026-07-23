import CoreDomain

/// Pure construction of `editVertex`/`replaceGeometry` commands from a vertex
/// handle interaction, plus the vertex-list and vertex-count-guard helpers a
/// vertex-edit UI needs before it can even offer an action.
///
/// Vertex-level reshape targets `LineString` and single-ring `Polygon`
/// geometry only. `MultiPolygon`/`MultiLineString` vertex-level editing is
/// explicitly out of scope, matching `InverseCommand.swift`'s own comment
/// about the foundation release not reaching multi-part vertex-level
/// commands, and the backend's identical scope note in
/// `services/api/.../domain/geometry-edit.ts`. A `Polygon`'s holes (rings
/// after the first) are likewise out of scope for this pass's UI — only the
/// exterior ring (index 0) is exposed as editable handles — though the
/// `editVertex` payload itself can already address any ring via `ringIndex`.
///
/// A closed polygon ring stores its first and last position as the same
/// point (see `MapGestureCommands.defaultSquareRing`'s doc comment, "the
/// repeated closing vertex"). The backend's `applyVertexOperation` edits
/// exactly the index it is given and never mirrors that duplicate — moving or
/// removing only one of the pair would silently open the ring and fail
/// server-side geometry validation. So:
/// - Moving that shared start/end vertex commits as `replaceGeometry` with
///   *both* copies updated together, never `editVertex`, which can only
///   touch one index per command.
/// - Removing it is not offered at all; removing a different corner first,
///   then moving, reaches the same shape without ever breaking closure.
/// Every other vertex of a ring, and every vertex of an open `LineString`
/// (which has no such duplicate), edits through a plain single-index
/// `editVertex`.
public enum MapVertexEditCommands {
    /// The full, raw vertex list `ringIndex` 0 addresses for `geometry` — as
    /// stored, including a closed polygon ring's repeated closing vertex.
    /// `nil` for a geometry type vertex editing does not support.
    public static func editableVertices(of geometry: Geometry) -> [Position]? {
        switch geometry {
        case let .lineString(line):
            return line
        case let .polygon(rings):
            return rings.first
        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    /// The vertex indices a vertex-edit UI should render a draggable handle
    /// for. For a `LineString` this is every index; for a `Polygon` this
    /// excludes the ring's final, duplicate closing index — the shape's
    /// first handle already represents that same point, and a second handle
    /// at the same screen position would only confuse the "how many corners
    /// does this shape have" reading. `nil` when vertex editing does not
    /// support this geometry.
    public static func renderableVertexIndices(of geometry: Geometry) -> [Int]? {
        switch geometry {
        case let .lineString(line):
            return Array(line.indices)
        case let .polygon(rings):
            guard let exterior = rings.first, exterior.count > 1 else { return nil }
            return Array(0..<(exterior.count - 1))
        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    /// The position at `index` in `editableVertices(of:)`, or `nil` when out
    /// of range or unsupported.
    public static func vertexPosition(of geometry: Geometry, index: Int) -> Position? {
        guard let vertices = editableVertices(of: geometry), index >= 0, index < vertices.count else { return nil }
        return vertices[index]
    }

    /// True when `vertexIndex` is the shared start/end position of a closed
    /// polygon ring — the one case a plain single-index `editVertex` cannot
    /// safely express. Always `false` for a `LineString`, which has no such
    /// duplicate.
    public static func isRingClosureVertex(_ geometryType: GeometryType, vertexIndex: Int, vertexCount: Int) -> Bool {
        geometryType == .polygon && (vertexIndex == 0 || vertexIndex == vertexCount - 1)
    }

    /// `geometry` with the vertex at `vertexIndex` moved to `newPosition`.
    /// For a `Polygon`'s shared start/end vertex, both copies move together
    /// so the ring stays closed. Used both to build the eventual
    /// `replaceGeometry` command for that one case and, by the view layer, to
    /// preview a drag before it commits.
    public static func movingVertex(in geometry: Geometry, vertexIndex: Int, to newPosition: Position) -> Geometry? {
        switch geometry {
        case let .lineString(originalLine):
            guard vertexIndex >= 0, vertexIndex < originalLine.count else { return nil }
            var line = originalLine
            line[vertexIndex] = newPosition
            return .lineString(line)

        case let .polygon(originalRings):
            guard var exterior = originalRings.first, vertexIndex >= 0, vertexIndex < exterior.count else { return nil }
            exterior[vertexIndex] = newPosition
            if isRingClosureVertex(.polygon, vertexIndex: vertexIndex, vertexCount: exterior.count) {
                exterior[0] = newPosition
                exterior[exterior.count - 1] = newPosition
            }
            var rings = originalRings
            rings[0] = exterior
            return .polygon(rings)

        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    /// The command a vertex-handle drag commits, or `nil` when `geometry` or
    /// `vertexIndex` is not one vertex editing supports.
    public static func moveVertexCommand(
        objectId: String,
        expectedRevision: Int,
        geometry: Geometry,
        vertexIndex: Int,
        to newPosition: Position
    ) -> MapCommandPayload? {
        guard let vertices = editableVertices(of: geometry), vertexIndex >= 0, vertexIndex < vertices.count else {
            return nil
        }

        if isRingClosureVertex(geometry.type, vertexIndex: vertexIndex, vertexCount: vertices.count) {
            guard let updatedGeometry = movingVertex(in: geometry, vertexIndex: vertexIndex, to: newPosition) else {
                return nil
            }
            return .replaceGeometry(
                ReplaceGeometryPayload(objectId: objectId, expectedRevision: expectedRevision, geometry: updatedGeometry)
            )
        }

        return .editVertex(
            EditVertexPayload(
                objectId: objectId,
                expectedRevision: expectedRevision,
                operation: .move,
                ringIndex: 0,
                vertexIndex: vertexIndex,
                position: newPosition
            )
        )
    }

    /// The midpoint of the edge running into `beforeIndex` (i.e. between
    /// `beforeIndex - 1` and `beforeIndex`) — both the position an "insert
    /// vertex here" command carries and the position a midpoint handle
    /// renders at, so the two can never disagree.
    public static func midpoint(of geometry: Geometry, beforeIndex: Int) -> Position? {
        guard let vertices = editableVertices(of: geometry), beforeIndex >= 1, beforeIndex <= vertices.count - 1 else {
            return nil
        }

        let a = vertices[beforeIndex - 1]
        let b = vertices[beforeIndex]
        return Position(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    }

    /// Every valid `beforeIndex` a midpoint handle can be rendered for, or
    /// `nil` when `geometry` has too few vertices to have an edge at all.
    public static func midpointBeforeIndices(of geometry: Geometry) -> [Int]? {
        guard let vertices = editableVertices(of: geometry), vertices.count >= 2 else { return nil }
        return Array(1...(vertices.count - 1))
    }

    /// The command an "insert a vertex on this edge" action commits, or
    /// `nil` when `beforeIndex` does not address a real edge.
    public static func insertVertexCommand(
        objectId: String,
        expectedRevision: Int,
        geometry: Geometry,
        beforeIndex: Int
    ) -> MapCommandPayload? {
        guard let position = midpoint(of: geometry, beforeIndex: beforeIndex) else { return nil }

        return .editVertex(
            EditVertexPayload(
                objectId: objectId,
                expectedRevision: expectedRevision,
                operation: .insert,
                ringIndex: 0,
                vertexIndex: beforeIndex,
                position: position
            )
        )
    }

    /// The command a "remove this vertex" action commits, or `nil` when
    /// removing would violate the minimum-vertex floor or touch the ring's
    /// shared start/end point (see this type's doc comment).
    public static func removeVertexCommand(
        objectId: String,
        expectedRevision: Int,
        geometry: Geometry,
        vertexIndex: Int
    ) -> MapCommandPayload? {
        guard canRemoveVertex(geometry: geometry, vertexIndex: vertexIndex) else { return nil }

        return .editVertex(
            EditVertexPayload(
                objectId: objectId,
                expectedRevision: expectedRevision,
                operation: .remove,
                ringIndex: 0,
                vertexIndex: vertexIndex
            )
        )
    }

    /// True when `vertexIndex` can be removed without violating the
    /// minimum-vertex floor or breaking a closed ring — what a vertex-edit
    /// action bar checks before even offering "Remove point."
    public static func canRemoveVertex(geometry: Geometry, vertexIndex: Int) -> Bool {
        guard let vertices = editableVertices(of: geometry), vertexIndex >= 0, vertexIndex < vertices.count else {
            return false
        }

        switch geometry {
        case .lineString:
            return vertices.count - 1 >= GeometryTolerances.minimumLineVertexCount
        case .polygon:
            guard !isRingClosureVertex(.polygon, vertexIndex: vertexIndex, vertexCount: vertices.count) else {
                return false
            }
            return vertices.count - 1 >= GeometryTolerances.minimumRingVertexCount
        case .point, .multiLineString, .multiPolygon:
            return false
        }
    }

    /// True when `atVertexIndex` is a valid interior vertex to `splitLinework`
    /// a `LineString` at — matches the backend's own `splitLineString` bound
    /// (`services/api/.../domain/geometry-edit.ts`: `atVertexIndex` strictly
    /// between the line's first and last index). Only `fence` and `path`
    /// objects offer split in this app's UI, but this check is
    /// category-agnostic; the caller applies the category restriction.
    public static func canSplit(geometry: Geometry, atVertexIndex: Int) -> Bool {
        guard case let .lineString(line) = geometry else { return false }
        return atVertexIndex > 0 && atVertexIndex < line.count - 1
    }
}
