import CoreDomain
import CoreGraphics

/// The categories the create toolbar offers in this pass.
///
/// Five categories, spanning all three geometry shapes (area, line, point) —
/// enough to prove the tap-to-create → select → drag → edit → delete pattern
/// generalizes across every shape the canvas draws, not an attempt at all
/// thirteen. Rendering already handles every category generically (see
/// `MapObjectRenderKind`); only *creation* is scoped down here.
///
/// TODO(P3-IOS-01): extend to `gate`, `zone`, `bed`, `waterFeature`,
/// `utilityExclusion`, `annotation`, `path`, and `importedBackground` once
/// each has a create flow that makes sense (a gate needs an existing fence to
/// attach to; an imported background needs a photo-import flow; and so on) —
/// deliberately not faked with a placeholder shape here.
public enum CreatableMapObjectCategory: String, Sendable, CaseIterable, Identifiable {
    case lot
    case structure
    case fence
    case tree
    case plant

    public var id: String { rawValue }

    public var category: GardenObjectCategory {
        switch self {
        case .lot: .lot
        case .structure: .structure
        case .fence: .fence
        case .tree: .tree
        case .plant: .plant
        }
    }
}

/// What a completed `DragGesture` turned out to be, decided once at
/// `.onEnded` rather than continuously — see ``MapGestureCommands``'s doc
/// comment on why classification happens exactly once.
public enum MapDragOutcome: Equatable, Sendable {
    /// Movement stayed under the tap threshold: treat the gesture as a tap at
    /// its start location, not a drag.
    case tap(CGPoint)
    /// Movement exceeded the threshold, starting on `objectId`: move that
    /// object by the gesture's total screen-space translation.
    case moveObject(objectId: String, translation: CGSize)
    /// Movement exceeded the threshold, starting on empty canvas: pan the
    /// viewport instead of moving anything.
    case pan(translation: CGSize)
}

/// Pure construction of domain commands from a gesture's start/end state.
///
/// A gesture (drag, pinch) is a client-only concept — see
/// `CoreDomain/Map/MapCommand.swift`'s module doc comment, "only the command
/// it commits crosses into durable state." Everything in this file turns a
/// gesture's already-resolved endpoints into exactly one command, so
/// `MapCanvasView`'s `.onEnded` handlers are the only place a command gets
/// built, never `.onChanged` — the work package's "commits ... on
/// drag-gesture end, not per-frame."
public enum MapGestureCommands {
    /// Screen-space movement below this is a tap, not a drag. Matches the
    /// shared snap tolerance, which is already expressed in screen pixels
    /// for the same reason (architecture/map-rendering-and-editing.md,
    /// section "3.3 Screen Space").
    public static let tapThresholdScreenPoints = Double(GeometryTolerances.snapToleranceScreenPixels)

    /// Classifies a completed drag gesture. `hitObjectId` is whatever
    /// `MapHitTesting` found at the gesture's *start* location, already
    /// filtered by the caller to "is this the currently selected object" —
    /// dragging an unselected shape pans instead of moving it, so a stray
    /// touch near another object never relocates it.
    public static func classifyDragEnd(
        startScreen: CGPoint,
        endScreen: CGPoint,
        selectedObjectIdAtStart: String?
    ) -> MapDragOutcome {
        let translation = CGSize(width: endScreen.x - startScreen.x, height: endScreen.y - startScreen.y)
        let magnitude = (translation.width * translation.width + translation.height * translation.height)
            .squareRoot()

        guard magnitude >= tapThresholdScreenPoints else {
            return .tap(startScreen)
        }

        if let objectId = selectedObjectIdAtStart {
            return .moveObject(objectId: objectId, translation: translation)
        }

        return .pan(translation: translation)
    }

    /// The single `moveObject` command a completed object-drag commits, or
    /// `nil` for a zero-length translation (nothing to submit).
    public static func moveCommand(
        objectId: String,
        expectedRevision: Int,
        translationMetres: PlanarOffset
    ) -> MapCommandPayload? {
        guard translationMetres.dx != 0 || translationMetres.dy != 0 else { return nil }

        return .moveObject(
            MoveObjectPayload(
                objectId: objectId,
                expectedRevision: expectedRevision,
                translationMetres: translationMetres
            )
        )
    }

    /// The `createObject` command a toolbar tap commits: a fixed-size default
    /// shape centred on the tapped location. Freehand drawing is explicitly
    /// out of scope for this pass (see the work package's scope note) — every
    /// created object starts as this default and is reshaped only by moving
    /// it as a whole or editing its properties, never by dragging a vertex.
    public static func createCommand(
        objectId: String,
        category: CreatableMapObjectCategory,
        at center: Position,
        label: String?
    ) -> MapCommandPayload {
        .createObject(
            CreateObjectPayload(
                objectId: objectId,
                category: category.category,
                geometry: defaultGeometry(for: category, at: center),
                label: label,
                categoryDetails: defaultDetails(for: category)
            )
        )
    }

    /// Half the side length, in metres, of the square a `lot`/`structure`
    /// create-tap places. Comfortably clears `minimumPolygonAreaSquareMetres`
    /// (16 m² versus a 0.01 m² floor) so the created shape never fails
    /// validation before a user has had a chance to resize it.
    private static let defaultAreaHalfSideMetres = 2.0

    /// Half the length, in metres, of the line a `fence` create-tap places.
    /// Clears `minimumLineLengthMetres` (3 m versus a 0.05 m floor) the same way.
    private static let defaultLineHalfLengthMetres = 1.5

    static func defaultGeometry(for category: CreatableMapObjectCategory, at center: Position) -> Geometry {
        switch category {
        case .lot, .structure:
            return .polygon([defaultSquareRing(center: center)])
        case .fence:
            return .lineString([
                Position(x: center.x - defaultLineHalfLengthMetres, y: center.y),
                Position(x: center.x + defaultLineHalfLengthMetres, y: center.y),
            ])
        case .tree, .plant:
            return .point(center)
        }
    }

    /// A closed 4-corner ring: 5 vertices including the repeated closing
    /// vertex, clearing `minimumRingVertexCount` (4).
    private static func defaultSquareRing(center: Position) -> [Position] {
        let half = defaultAreaHalfSideMetres
        let corners = [
            Position(x: center.x - half, y: center.y - half),
            Position(x: center.x + half, y: center.y - half),
            Position(x: center.x + half, y: center.y + half),
            Position(x: center.x - half, y: center.y + half),
        ]

        return corners + [corners[0]]
    }

    /// Minimal, honest defaults — never fabricated data. `PlantPlacementDetails.commonName`
    /// starts empty and `quantity` starts at 1 (the schema's own smallest
    /// meaningful value); a user fills in the real name in the property sheet
    /// this pass opens immediately after create.
    static func defaultDetails(for category: CreatableMapObjectCategory) -> GardenObjectDetails? {
        switch category {
        case .lot:
            return nil
        case .structure:
            return .structure(StructureDetails(structureKind: .other))
        case .fence:
            return .fence(FenceDetails(fenceKind: .other))
        case .tree:
            return .tree(TreeDetails())
        case .plant:
            return .plant(PlantPlacementDetails(commonName: "", quantity: 1))
        }
    }
}
