import CoreDomain
import CoreGraphics

/// The categories the create toolbar offers.
///
/// All twelve non-`importedBackground` categories, spanning every geometry
/// shape (area, line, point) the canvas draws. `importedBackground` is the
/// one category deliberately left out: creating one needs a photo/plan
/// upload flow that does not exist yet — Phase 6 scope
/// (docs/implementation-plan.md, "Media, Photos, and Property-Plan
/// Import") — so it is never faked with a placeholder shape here.
///
/// `gate` is creatable like every other category, but carries an extra
/// precondition the toolbar and view model enforce together: a gate cannot
/// exist without an existing `fence` to attach to (`GateDetails.fenceObjectId`
/// is required, never fabricated). See `MapEditorViewModel.hasFence` and
/// `MapEditorViewModelEditing.swift`'s gate-creation handling.
public enum CreatableMapObjectCategory: String, Sendable, CaseIterable, Identifiable {
    case lot
    case structure
    case fence
    case gate
    case path
    case zone
    case bed
    case waterFeature
    case utilityExclusion
    case tree
    case plant
    case annotation

    public var id: String { rawValue }

    public var category: GardenObjectCategory {
        switch self {
        case .lot: .lot
        case .structure: .structure
        case .fence: .fence
        case .gate: .gate
        case .path: .path
        case .zone: .zone
        case .bed: .bed
        case .waterFeature: .waterFeature
        case .utilityExclusion: .utilityExclusion
        case .tree: .tree
        case .plant: .plant
        case .annotation: .annotation
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
    /// shape centred on the tapped location. Freehand drawing of a brand-new
    /// multi-point shape at creation time remains out of scope (see
    /// `MapVertexEditCommands`'s and `MapShapeTransform`'s doc comments for
    /// what *does* reshape an object once it exists) — every created object
    /// starts as this default shape.
    ///
    /// `fenceObjectId` is required, and only meaningful, for `category ==
    /// .gate` — see `GateDetails`'s doc comment ("a gate is always positioned
    /// along exactly one fence"). The caller (`MapEditorViewModelEditing.swift`)
    /// resolves it before calling this, never here: this function stays a
    /// pure mapping from already-known inputs to a command, not a place that
    /// reaches into view-model state to find a fence.
    public static func createCommand(
        objectId: String,
        category: CreatableMapObjectCategory,
        at center: Position,
        label: String?,
        fenceObjectId: String? = nil
    ) -> MapCommandPayload {
        .createObject(
            CreateObjectPayload(
                objectId: objectId,
                category: category.category,
                geometry: defaultGeometry(for: category, at: center),
                label: label,
                categoryDetails: defaultDetails(for: category, fenceObjectId: fenceObjectId)
            )
        )
    }

    /// Half the side length, in metres, of the square a `lot`/`structure`/
    /// `zone`/`bed`/`waterFeature`/`utilityExclusion` create-tap places.
    /// Comfortably clears `minimumPolygonAreaSquareMetres` (16 m² versus a
    /// 0.01 m² floor) so the created shape never fails validation before a
    /// user has had a chance to resize it.
    private static let defaultAreaHalfSideMetres = 2.0

    /// Half the length, in metres, of the line a `fence`/`path` create-tap
    /// places. Clears `minimumLineLengthMetres` (3 m versus a 0.05 m floor)
    /// the same way.
    private static let defaultLineHalfLengthMetres = 1.5

    /// Half the length, in metres, of the line a `gate` create-tap places —
    /// deliberately shorter than `defaultLineHalfLengthMetres`, matching
    /// `GardenObjectCategory`'s own framing of a gate as "a short segment,
    /// not a full linework category of its own." Still clears
    /// `minimumLineLengthMetres` (1 m versus a 0.05 m floor).
    private static let defaultGateHalfLengthMetres = 0.5

    static func defaultGeometry(for category: CreatableMapObjectCategory, at center: Position) -> Geometry {
        switch category {
        case .lot, .structure, .zone, .bed, .waterFeature, .utilityExclusion:
            return .polygon([defaultSquareRing(center: center)])
        case .fence, .path:
            return .lineString([
                Position(x: center.x - defaultLineHalfLengthMetres, y: center.y),
                Position(x: center.x + defaultLineHalfLengthMetres, y: center.y),
            ])
        case .gate:
            return .lineString([
                Position(x: center.x - defaultGateHalfLengthMetres, y: center.y),
                Position(x: center.x + defaultGateHalfLengthMetres, y: center.y),
            ])
        case .tree, .plant, .annotation:
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

    /// Minimal, honest defaults — never fabricated data.
    /// `PlantPlacementDetails.commonName` starts empty and `quantity` starts
    /// at 1 (the schema's own smallest meaningful value); a user fills in the
    /// real name in the property sheet, which opens immediately after
    /// create. Mirrors `packages/geometry-contracts/src/object-category.ts`'s
    /// defaults.
    ///
    /// `fenceObjectId` is required for `.gate` — `GateDetails.fenceObjectId`
    /// is a non-optional `String` — and ignored for every other category.
    /// Returns `nil` for `.gate` when no fence id is supplied, which the
    /// caller must treat as "cannot create this gate yet," never as "gate has
    /// no details."
    static func defaultDetails(for category: CreatableMapObjectCategory, fenceObjectId: String? = nil) -> GardenObjectDetails? {
        switch category {
        case .lot, .path, .waterFeature:
            return nil
        case .structure:
            return .structure(StructureDetails(structureKind: .other))
        case .fence:
            return .fence(FenceDetails(fenceKind: .other))
        case .gate:
            guard let fenceObjectId else { return nil }
            return .gate(GateDetails(fenceObjectId: fenceObjectId))
        case .zone:
            return .zone(ZoneDetails(zoneKind: .other))
        case .bed:
            return .bed(BedDetails(bedKind: .inGround))
        case .utilityExclusion:
            return .utilityExclusion(UtilityExclusionDetails(utilityExclusionKind: .other))
        case .tree:
            return .tree(TreeDetails())
        case .plant:
            return .plant(PlantPlacementDetails(commonName: "", quantity: 1))
        case .annotation:
            return .annotation(AnnotationDetails(measurement: nil))
        }
    }
}
