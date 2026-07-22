import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the map editor: rendering data, selection, viewport,
/// undo/redo, and every editing command this pass wires up.
///
/// No local GRDB cache backs this view model, unlike `GardensListViewModel`.
/// Nearly every map command payload carries an `expectedRevision` (see
/// `CoreDomain/Map/MapCommandPayloads.swift`) — optimistic concurrency the
/// backend enforces on purpose — and the undo stack's correctness depends on
/// knowing the *exact* revision the server last assigned. A locally cached,
/// possibly-stale revision would turn every command into a coin flip on a
/// `409`/`412` instead of the deliberate check the backend performs; the
/// garden list's cache exists to make a list feel instant before a network
/// round trip resolves, and there is no equivalent value here — the editor
/// cannot let a user start moving shapes against data it cannot vouch is
/// current, and it cannot draw anything before the first `GET .../map`
/// completes regardless of a cache. Offline editing with a local outbox is
/// explicitly out of scope for this pass (architecture/offline-
/// synchronization.md), so "always fresh from server" is the whole caching
/// policy, not a placeholder for a fuller one.
///
/// Source: implementation-plan.md work packages P3-IOS-01, P3-IOS-02.
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

    let gardenId: String
    let loadGardenMap: LoadGardenMap
    let submitMapCommand: SubmitMapCommand
    let strings: LocalizedStrings

    var objectsById: [String: GardenMapObject] = [:]
    var orderedObjectIds: [String] = []
    var undoStack = MapUndoStack()
    private var hasFitInitialViewport = false
    private var viewportSize = CGSize.zero

    public init(
        gardenId: String,
        loadGardenMap: LoadGardenMap,
        submitMapCommand: SubmitMapCommand,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.loadGardenMap = loadGardenMap
        self.submitMapCommand = submitMapCommand
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
    /// where restore lives.
    public var accessibleRows: [MapAccessibleObjectRow] {
        orderedObjectIds.compactMap { objectsById[$0] }.map(accessibleRow)
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

        do {
            let document = try await loadGardenMap(gardenId: gardenId)
            objectsById = Dictionary(uniqueKeysWithValues: document.objects.map { ($0.id, $0) })
            orderedObjectIds = document.objects.map(\.id)
            georeference = document.georeference
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
    func refreshRenderState() {
        let renderObjects = orderedObjectIds
            .compactMap { objectsById[$0] }
            .filter { $0.lifecycleState == .active }
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
