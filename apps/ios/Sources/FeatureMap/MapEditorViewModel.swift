import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the map editor: rendering data, selection, viewport,
/// undo/redo, and every editing command this pass wires up.
///
/// Reads are still always fresh from the server, never cache-first — see
/// `LoadGardenMap`'s doc comment for why the reasoning that originally
/// justified this ("nearly every map command payload carries an
/// `expectedRevision`... a locally cached, possibly-stale revision would turn
/// every command into a coin flip on a `409`/`412`") still holds even now
/// that a local `garden_object` table exists behind it (P5-IOS-02, Stage 4b).
/// What changed in that stage is the *write* path: every command below now
/// commits through `applyMapCommandOffline` — one atomic local transaction,
/// no network call — instead of waiting on `submitMapCommand`'s round trip;
/// see `MapEditorViewModelEditing.submit`'s own doc comment.
///
/// Source: implementation-plan.md work packages P3-IOS-01, P3-IOS-02,
/// P5-IOS-02.
@MainActor
@Observable
public final class MapEditorViewModel {
    public internal(set) var state: MapEditorViewState = .loading
    public internal(set) var transform = MapViewportTransform(scale: 20, origin: .zero)
    public internal(set) var selectedObjectId: String?
    public var armedCreateCategory: CreatableMapObjectCategory?
    public internal(set) var isSubmitting = false
    public internal(set) var errorMessage: String?
    /// Drives property-sheet presentation; `nil` means the sheet is closed.
    public internal(set) var propertySheetObjectId: String?
    /// Set while placing a `gate`, between "user tapped the canvas" and "user
    /// chose which fence it belongs to" — see `MapEditorViewModelEditing.swift`'s
    /// gate-creation handling. Drives the fence-picker sheet.
    public internal(set) var pendingGateCreationScreenPoint: CGPoint?
    /// The object currently in vertex-edit mode, or `nil` when the canvas is
    /// in its ordinary select/move mode. See `MapEditorViewModelReshaping.swift`.
    public internal(set) var vertexEditObjectId: String?
    /// The vertex handle last tapped while in vertex-edit mode — what the
    /// shape-edit action bar's "Remove point"/"Split here" act on.
    public internal(set) var selectedVertexIndex: Int?
    /// Armed by the vertex-edit action bar's snap toggle to skip
    /// ``MapSnapping`` for exactly the *next* vertex-handle drag — the
    /// touch-appropriate stand-in for a keyboard modifier (this app has
    /// none) that lets a user temporarily disable snapping, per
    /// architecture/map-rendering-and-editing.md section "10". Consumed
    /// (reset to `false`) the moment that drag commits
    /// (`MapEditorViewModelReshaping.commitVertexMove`), or vertex-edit mode
    /// starts or ends, so it never persists as a standing "snapping is off"
    /// preference — persisting it across gestures is explicitly out of
    /// scope this pass.
    public internal(set) var isVertexDragSnapSuppressed = false
    /// Set while choosing the second object for a `joinLinework` command —
    /// see `MapEditorViewModelLinework.swift`.
    public internal(set) var pendingJoinFirstObjectId: String?

    /// Layers hidden from both `MapCanvasView`'s rendering and
    /// `MapObjectListView`'s accessible rows — a client-only session
    /// preference (architecture/map-rendering-and-editing.md, section
    /// "12. Layer Model": "Layer visibility and opacity are user
    /// preferences"), never submitted as a command. Reset at the start of
    /// every `load()`, the same as `selectedObjectId`/`propertySheetObjectId`
    /// just above — there is no persistence requirement this pass. See
    /// `MapEditorViewModelLayers.swift` for the toggle/query API.
    public internal(set) var hiddenLayers: Set<MapLayer> = []
    /// Layers whose objects cannot be selected, dragged, vertex-edited,
    /// resized/rotated, deleted, or duplicated right now — the same
    /// session-only status as ``hiddenLayers``. See
    /// `MapEditorViewModelLayers.swift`'s doc comment for the full list of
    /// gated entry points.
    public internal(set) var lockedLayers: Set<MapLayer> = []
    /// The map document's server-reported cross-object validation summary,
    /// set fresh on every `load()`. See `MapValidationPresentation`'s doc
    /// comment for why this is reliably empty against the real API today.
    public internal(set) var validationSummary: [GardenMapValidationIssue] = []
    /// Richer, persistent presentation of the same in-flight/outcome state
    /// `isSubmitting` already tracks — see ``MapSaveStatus``'s doc comment.
    /// Updated alongside `isSubmitting` by every command-submitting function
    /// (`MapEditorViewModelEditing.submit`, `MapEditorViewModelUndoRedo.submitUndoRedo`).
    public internal(set) var saveStatus: MapSaveStatus = .idle

    let gardenId: String
    let loadGardenMap: LoadGardenMap
    let submitMapCommand: SubmitMapCommand
    let applyMapCommandOffline: ApplyMapCommandOffline
    let strings: LocalizedStrings

    var objectsById: [String: GardenMapObject] = [:]
    var orderedObjectIds: [String] = []
    var undoStack = MapUndoStack()
    /// Set from the document's `coordinateSpaceId` on every `load()` —
    /// `createObject`/`duplicateObject`'s offline projection needs this to
    /// build a brand-new `GardenMapObject` without a network call (the online
    /// path instead has the server derive it lazily; see
    /// `create-map-object.ts`'s own doc comment). `nil` only before the first
    /// `load()` completes, exactly like `georeference` just below.
    var coordinateSpaceId: String?
    private var hasFitInitialViewport = false
    private var viewportSize = CGSize.zero

    public init(
        gardenId: String,
        loadGardenMap: LoadGardenMap,
        submitMapCommand: SubmitMapCommand,
        applyMapCommandOffline: ApplyMapCommandOffline,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.loadGardenMap = loadGardenMap
        self.submitMapCommand = submitMapCommand
        self.applyMapCommandOffline = applyMapCommandOffline
        self.strings = strings
    }

    public var title: String { strings(.mapEditorTitle) }
    public var loadingMessage: String { strings(.mapEditorLoading) }
    public var retryTitle: String { strings(.mapEditorRetry) }
    public var canvasTabTitle: String { strings(.mapTabCanvas) }
    public var listTabTitle: String { strings(.mapTabList) }
    public var undoTitle: String { strings(.mapUndo) }
    public var redoTitle: String { strings(.mapRedo) }
    public var undoUnavailableMessage: String { strings(.mapUndoUnavailable) }
    public var createSectionTitle: String { strings(.mapCreateSectionTitle) }
    public var cancelPlacingTitle: String { strings(.mapCreateCancel) }
    public var listEmptyMessage: String { strings(.mapListEmpty) }

    public var creatableCategories: [CreatableMapObjectCategory] { CreatableMapObjectCategory.allCases }

    public func creatableCategoryName(_ category: CreatableMapObjectCategory) -> String {
        MapCategoryLocalization.name(for: category.category, strings: strings)
    }

    public var createHint: String? {
        guard let armedCreateCategory else { return nil }
        return strings.string(.mapCreateHint, parameters: ["category": creatableCategoryName(armedCreateCategory)])
    }

    public var gatePickerTitle: String { strings(.mapGatePickerTitle) }

    /// Non-`nil` while ``vertexEditObjectId`` is set — the shape-edit action
    /// bar's instructional banner, matching ``createHint``'s "show a banner
    /// only while the mode is active" pattern.
    public var vertexEditHint: String? {
        guard vertexEditObjectId != nil else { return nil }
        return strings(.mapVertexEditHint)
    }
    public var vertexEditDoneTitle: String { strings(.mapVertexEditDone) }
    public var vertexEditRemoveTitle: String { strings(.mapVertexEditRemove) }
    public var vertexEditSplitTitle: String { strings(.mapVertexEditSplitHere) }
    /// The vertex-edit action bar's snap-toggle button title — one of two,
    /// depending on ``isVertexDragSnapSuppressed``, each phrased as the
    /// action tapping it performs (matching ``vertexEditRemoveTitle``'s and
    /// ``vertexEditSplitTitle``'s "imperative verb" phrasing).
    public var vertexEditSnapToggleTitle: String {
        strings(isVertexDragSnapSuppressed ? .mapVertexEditSnapEnable : .mapVertexEditSnapDisable)
    }

    /// Non-`nil` while a join is pending a second object — see
    /// `MapEditorViewModelLinework.swift`.
    public var joinSelectionHint: String? {
        guard let firstId = pendingJoinFirstObjectId, let object = objectsById[firstId] else { return nil }
        return strings.string(
            .mapLineworkJoinHint,
            parameters: ["category": MapCategoryLocalization.name(for: object.category, strings: strings)]
        )
    }
    public var joinCancelTitle: String { strings(.mapLineworkJoinCancel) }

    /// "Georeferenced · ±{accuracy} m accuracy", or an informational "no
    /// scale set" message — see ``MapScalePresentation``.
    public var scaleIndicatorText: String { MapScalePresentation.text(for: georeference, strings: strings) }

    public var disclosureText: String { strings(.mapDisclosureNonSurvey) }
    public var disclosureDismissTitle: String { strings(.mapDisclosureDismiss) }

    public var saveStatusSavingText: String { strings(.mapSaveStatusSaving) }
    public var saveStatusSavedLocallyText: String { strings(.mapSaveStatusSavedLocally) }
    public var saveStatusSavedText: String { strings(.mapSaveStatusSaved) }
    public var saveStatusFailedText: String { strings(.mapSaveStatusFailed) }

    /// True when at least one current validation issue is `.error` severity
    /// — what the warnings toolbar button uses to pick a more urgent icon
    /// over a plain warning triangle.
    public var hasValidationErrors: Bool { validationSummary.contains { $0.severity == .error } }

    public var warningsButtonTitle: String {
        strings.string(.mapWarningsButtonTitle, parameters: ["count": "\(validationSummary.count)"])
    }

    public var canUndo: Bool { undoStack.canUndo && !isSubmitting }
    public var canRedo: Bool { undoStack.canRedo && !isSubmitting }
    /// True when the top undo entry exists but has no computable inverse —
    /// the view uses this to show ``undoUnavailableMessage`` instead of just
    /// disabling the control with no explanation.
    public var undoIsBlocked: Bool { undoStack.topUndoIsBlocked }

    /// Set from the document's `georeference` on load; `nil` for an
    /// ungeoreferenced garden, which is what keeps `MapBackgroundView` off
    /// the screen entirely for most gardens — see that view's doc comment.
    public internal(set) var georeference: GardenGeoreference?

    public var selectedObject: GardenMapObject? {
        selectedObjectId.flatMap { objectsById[$0] }
    }

    /// True when the garden has at least one active `fence` — what gates the
    /// `gate` toolbar button, since `GateDetails.fenceObjectId` cannot be
    /// fabricated (see `CreatableMapObjectCategory`'s doc comment).
    public var hasFence: Bool {
        objectsById.values.contains { $0.category == .fence && $0.lifecycleState == .active }
    }

    /// Active fences, in document order — the fence-picker sheet's options
    /// once a gate placement tap is confirmed.
    public var availableFences: [GardenMapObject] {
        orderedObjectIds.compactMap { objectsById[$0] }
            .filter { $0.category == .fence && $0.lifecycleState == .active }
    }

    /// The object the property sheet is actually showing — driven by
    /// ``propertySheetObjectId``, not ``selectedObjectId``, since the two can
    /// diverge (canvas selection changes are still possible while nothing is
    /// yet open in the sheet).
    public var propertySheetObject: GardenMapObject? {
        propertySheetObjectId.flatMap { objectsById[$0] }
    }

    public var editSelectedTitle: String { strings(.mapPropertyTitle) }
    public var deleteSelectedTitle: String { strings(.mapPropertyDelete) }
    public var listDeleteActionTitle: String { strings(.mapListDeleteAction) }
    public var listRestoreActionTitle: String { strings(.mapListRestoreAction) }

    /// Every object, active and deleted, as rows for the accessible list —
    /// unlike the render snapshot, which omits deleted objects because
    /// `Canvas` has no way to represent "restore" as a gesture. The list is
    /// where restore lives. Also filters out any object in a currently
    /// hidden layer, matching the render snapshot's own filter
    /// (`refreshRenderState()`) — the canvas and the accessible list must
    /// agree on what's visible, per the work package.
    public var accessibleRows: [MapAccessibleObjectRow] {
        orderedObjectIds
            .compactMap { objectsById[$0] }
            .filter { !hiddenLayers.contains(MapLayer(category: $0.category)) }
            .map(accessibleRow)
    }

    func accessibleRow(for object: GardenMapObject) -> MapAccessibleObjectRow {
        MapAccessibilityLabels.row(
            for: object,
            categoryName: MapCategoryLocalization.name(for: object.category, strings: strings),
            untitledFallback: strings(.mapListUntitled),
            deletedSuffix: strings(.mapListDeletedSuffix)
        )
    }

    public func load() async {
        state = .loading
        errorMessage = nil
        selectedObjectId = nil
        propertySheetObjectId = nil
        // Layer visibility/locking is session-only UI preference, not
        // server-persisted domain state — it resets on every load, the same
        // as the selection/sheet state just above.
        hiddenLayers = []
        lockedLayers = []

        do {
            let document = try await loadGardenMap(gardenId: gardenId)
            objectsById = Dictionary(uniqueKeysWithValues: document.objects.map { ($0.id, $0) })
            orderedObjectIds = document.objects.map(\.id)
            georeference = document.georeference
            validationSummary = document.validationSummary
            coordinateSpaceId = document.coordinateSpaceId
            undoStack = MapUndoStack()
            hasFitInitialViewport = false
            refreshRenderState()
            fitInitialViewportIfNeeded()
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Rebuilds ``state``'s render snapshot from local object state. Called
    /// after every load and after every command's confirmed result is folded
    /// in — never mid-gesture, which is what keeps the snapshot a value
    /// `MapCanvasView` can treat as immutable for the duration of one draw.
    /// Also called directly by `MapEditorViewModelLayers.toggleLayerVisibility`
    /// so a visibility toggle is reflected on the canvas immediately, without
    /// waiting for another server round trip.
    func refreshRenderState() {
        let renderObjects = orderedObjectIds
            .compactMap { objectsById[$0] }
            .filter { $0.lifecycleState == .active }
            .filter { !hiddenLayers.contains(MapLayer(category: $0.category)) }
            .map(MapRenderObject.init)

        state = .loaded(MapRenderSnapshot(objects: renderObjects))
    }

    /// Folds a command's confirmed server result into local object state and
    /// refreshes the render snapshot. Returns the first affected object —
    /// every command this editor issues targets exactly one object — or
    /// `nil` for a response with none, which should not happen but is not
    /// treated as fatal.
    @discardableResult
    func foldAffectedObjects(_ objects: [GardenMapObject]) -> GardenMapObject? {
        for affected in objects {
            if objectsById[affected.id] == nil {
                orderedObjectIds.append(affected.id)
            }
            objectsById[affected.id] = affected
        }

        refreshRenderState()
        return objects.first
    }

    /// Called once the canvas reports its on-screen size, and again on
    /// rotation/resize. Only the *first* report after a load drives a
    /// fit-to-content transform — after that, the user's own pan/zoom owns
    /// the transform, so a rotation does not silently recentre the view out
    /// from under them.
    public func updateViewportSize(_ size: CGSize) {
        viewportSize = size
        fitInitialViewportIfNeeded()
    }

    private func fitInitialViewportIfNeeded() {
        guard !hasFitInitialViewport, viewportSize.width > 0, viewportSize.height > 0,
            case let .loaded(snapshot) = state
        else { return }

        transform = .fitting(bounds: snapshot.bounds, viewportSize: viewportSize)
        hasFitInitialViewport = true
    }

    public func pan(byScreenTranslation translation: CGSize) {
        transform = transform.panned(byScreenTranslation: translation)
    }

    public func zoom(by factor: Double, around anchor: CGPoint) {
        transform = transform.zoomed(by: factor, around: anchor)
    }

    func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
