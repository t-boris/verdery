import Foundation

/// Where a photograph was probably taken, expressed as a garden area.
///
/// A proposal, never an answer. `map-rendering-and-editing.md` section 3.2
/// already fixes this posture for device heading — "only proposed evidence and
/// never silently changes an accepted map orientation" — and a coordinate
/// deserves the same treatment for the same reason: consumer GPS is accurate
/// to a few metres, which resolves a bed and does not resolve a plant.
public struct PlacementProposal: Sendable, Equatable {
    /// The area the phone appears to be standing in.
    public let mapObjectId: String
    /// Where it thinks it is, in the garden's own metres.
    public let localPosition: Position
    /// What the device claimed about its own fix.
    public let accuracyMetres: Double?

    /// Whether the fix is tight enough for this particular area.
    ///
    /// Compared against the area's own size rather than a fixed threshold: a
    /// five-metre fix genuinely identifies a twenty-metre zone and says almost
    /// nothing about a one-metre herb bed. A proposal that fails this is still
    /// offered — it is usually right, and the alternative is a list of every
    /// object in the garden — but it is offered as a guess rather than as a
    /// finding.
    public let isWithinAccuracy: Bool
}

public enum PlacementProposals {
    /// Areas a plant can meaningfully be placed in. A fence or a path is
    /// somewhere to stand, not somewhere to plant.
    private static let plantableAreas: Set<GardenObjectCategory> = [.bed, .zone]

    /// - Returns: the smallest plantable area containing the coordinate, or
    ///   `nil` when the garden has no georeference, the coordinate falls
    ///   outside every area, or there is nothing to propose. Every one of
    ///   those is a case where saying nothing is better than guessing.
    public static func propose(
        latitude: Double,
        longitude: Double,
        accuracyMetres: Double?,
        georeference: GardenGeoreference?,
        objects: [GardenMapObject]
    ) -> PlacementProposal? {
        guard
            let georeference,
            let local = GeographicProjection.localPosition(
                latitude: latitude, longitude: longitude, georeference: georeference
            )
        else {
            return nil
        }

        // Smallest first: a bed inside a zone is the more useful answer, and
        // nesting is normal in this product rather than exceptional.
        let containing =
            objects
            .filter { $0.lifecycleState == .active }
            .filter { plantableAreas.contains($0.category) }
            .filter { PolygonContainment.contains(local, in: $0.geometry) }
            .compactMap { object -> (GardenMapObject, Double)? in
                guard let extent = boundingExtent(of: object.geometry) else { return nil }
                return (object, extent)
            }
            .min { $0.1 < $1.1 }

        guard let (object, extent) = containing else { return nil }

        return PlacementProposal(
            mapObjectId: object.id,
            localPosition: local,
            accuracyMetres: accuracyMetres,
            isWithinAccuracy: (accuracyMetres ?? .infinity) <= extent / 2
        )
    }

    /// The longer side of a geometry's bounding box, in metres — a cheap stand-in
    /// for "how big is this", which is all the accuracy comparison needs.
    private static func boundingExtent(of geometry: Geometry) -> Double? {
        let positions: [Position]
        switch geometry {
        case let .polygon(rings):
            positions = rings.flatMap { $0 }
        case let .multiPolygon(polygons):
            positions = polygons.flatMap { $0.flatMap { $0 } }
        case .point, .lineString, .multiLineString:
            return nil
        }

        guard
            let minX = positions.map(\.x).min(),
            let maxX = positions.map(\.x).max(),
            let minY = positions.map(\.y).min(),
            let maxY = positions.map(\.y).max()
        else {
            return nil
        }
        return max(maxX - minX, maxY - minY)
    }
}
