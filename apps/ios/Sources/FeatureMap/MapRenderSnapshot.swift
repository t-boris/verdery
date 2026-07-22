import CoreDomain

/// One object as the canvas and the accessible list draw it: only the fields
/// rendering and hit-testing need, not the full ``GardenMapObject`` (revision,
/// timestamps, coordinate space id — irrelevant to drawing a shape).
public struct MapRenderObject: Equatable, Sendable, Identifiable {
    public let id: String
    public let category: GardenObjectCategory
    public let geometry: Geometry
    public let label: String?
    public let lifecycleState: ObjectLifecycleState

    public init(id: String, category: GardenObjectCategory, geometry: Geometry, label: String?, lifecycleState: ObjectLifecycleState) {
        self.id = id
        self.category = category
        self.geometry = geometry
        self.label = label
        self.lifecycleState = lifecycleState
    }

    public init(_ object: GardenMapObject) {
        self.init(
            id: object.id,
            category: object.category,
            geometry: object.geometry,
            label: object.label,
            lifecycleState: object.lifecycleState
        )
    }
}

/// The immutable value `MapCanvasView` draws from.
///
/// Built once per accepted server state (a fresh `load()`, or a command's
/// result folded back in) and never recomputed mid-gesture — "render
/// snapshots are immutable and Sendable," architecture/map-rendering-and-
/// editing.md section 14. A drag or pinch in progress moves a transform or a
/// screen-space preview offset, never this value; only a committed command
/// produces a new one.
///
/// Deleted objects are omitted, matching what `GET .../map` itself returns
/// ("every *active* object") — the map editor's accessible list, not this
/// snapshot, is where a just-deleted object stays visible with a Restore
/// action; see `MapEditorViewModel`.
public struct MapRenderSnapshot: Equatable, Sendable {
    public let objects: [MapRenderObject]
    public let bounds: MapContentBounds

    public init(objects: [MapRenderObject]) {
        self.objects = objects
        self.bounds = Self.computeBounds(objects)
    }

    public static let empty = MapRenderSnapshot(objects: [])

    private static func computeBounds(_ objects: [MapRenderObject]) -> MapContentBounds {
        var bounds: MapContentBounds?

        for object in objects {
            for position in object.geometry.positions {
                bounds = (bounds ?? MapContentBounds(minX: position.x, minY: position.y, maxX: position.x, maxY: position.y))
                    .union(position)
            }
        }

        return bounds ?? .empty
    }
}

/// What shape a geometry instance draws as, independent of category — a
/// `Point` is always a marker, a `Polygon`/`MultiPolygon` is always a filled
/// area, a `LineString`/`MultiLineString` is always a stroked line. Deriving
/// this from the geometry's own type, rather than switching on category,
/// means every one of the 13 categories renders correctly the moment it
/// appears in a document, including the eight this pass has no create-toolbar
/// entry for — "render every object category," not "render the five this
/// pass can create."
public enum MapObjectRenderKind: Sendable, Equatable {
    case area
    case line
    case marker

    public init(geometryType: GeometryType) {
        switch geometryType {
        case .polygon, .multiPolygon: self = .area
        case .lineString, .multiLineString: self = .line
        case .point: self = .marker
        }
    }
}

/// A stable colour identity per category, resolved to an actual `Color` only
/// in the view layer (`MapCanvasView`) — keeping this file, and everything
/// that tests against it, free of a SwiftUI import.
public enum MapObjectColorToken: Sendable, Hashable, CaseIterable {
    case lot, structure, fence, gate, path, zone, bed, waterFeature
    case utilityExclusion, tree, plant, annotation, importedBackground

    public init(category: GardenObjectCategory) {
        switch category {
        case .lot: self = .lot
        case .structure: self = .structure
        case .fence: self = .fence
        case .gate: self = .gate
        case .path: self = .path
        case .zone: self = .zone
        case .bed: self = .bed
        case .waterFeature: self = .waterFeature
        case .utilityExclusion: self = .utilityExclusion
        case .tree: self = .tree
        case .plant: self = .plant
        case .annotation: self = .annotation
        case .importedBackground: self = .importedBackground
        }
    }
}
