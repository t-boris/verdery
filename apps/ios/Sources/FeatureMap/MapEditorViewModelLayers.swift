import CoreDomain
import CoreLocalization

/// Layer visibility and locking — client-only session preferences
/// (architecture/map-rendering-and-editing.md, section "12. Layer Model":
/// "Layer visibility and opacity are user preferences. Domain objects do not
/// store arbitrary visual stacking..."), never submitted as a command and
/// never persisted past this session — see `MapEditorViewModel.hiddenLayers`'s
/// and `.lockedLayers`'s doc comments.
///
/// Locking blocks every mutating/selecting interaction this editor offers
/// for objects in that layer:
/// - select — `MapEditorViewModelEditing.handleCanvasTap`/`selectFromList`
/// - drag — `MapEditorViewModelEditing.handleObjectDragEnded`
/// - vertex-editing — `MapEditorViewModelReshaping.beginVertexEdit`/
///   `commitVertexMove`/`commitVertexInsert`/`commitRemoveSelectedVertex`
/// - resize/rotate — `MapEditorViewModelReshaping.commitResize`/`commitRotate`
/// - delete — `MapEditorViewModelEditing.delete(objectId:)`
/// - duplicate — `MapEditorViewModelDuplication.duplicate(objectId:)`
///
/// Each of those functions, in their own files, guards on ``isObjectLocked``
/// before doing anything — a locked-layer object is treated exactly like
/// nothing was hit/selected, the same way this editor already treats an
/// out-of-range gesture. This file owns the shared predicate plus the
/// toolbar-facing toggle/query/naming API only.
extension MapEditorViewModel {
    public var layers: [MapLayer] { MapLayer.allCases }

    public func layerName(_ layer: MapLayer) -> String {
        MapCategoryLocalization.name(for: layer, strings: strings)
    }

    public var layersButtonTitle: String { strings(.mapLayersButtonTitle) }

    public func isLayerVisible(_ layer: MapLayer) -> Bool { !hiddenLayers.contains(layer) }
    public func isLayerLocked(_ layer: MapLayer) -> Bool { lockedLayers.contains(layer) }

    /// Toggles `layer`'s visibility and, if the editor currently has loaded
    /// content, immediately rebuilds the render snapshot so the canvas and
    /// the accessible list agree on what's visible without waiting for
    /// another server round trip.
    public func toggleLayerVisibility(_ layer: MapLayer) {
        if hiddenLayers.contains(layer) {
            hiddenLayers.remove(layer)
        } else {
            hiddenLayers.insert(layer)
        }
        if case .loaded = state {
            refreshRenderState()
        }
    }

    /// Toggles `layer`'s lock. Unlike visibility, locking does not need a
    /// render-state rebuild: it never changes what's drawn, only what
    /// interactions the gated functions above accept.
    public func toggleLayerLock(_ layer: MapLayer) {
        if lockedLayers.contains(layer) {
            lockedLayers.remove(layer)
        } else {
            lockedLayers.insert(layer)
        }
    }

    /// The shared "is this object off-limits to interaction right now"
    /// predicate every gated entry point (see this file's doc comment)
    /// checks before doing anything.
    func isObjectLocked(_ object: GardenMapObject) -> Bool {
        lockedLayers.contains(MapLayer(category: object.category))
    }

    /// A button/accessibility label phrased as the action tapping it would
    /// perform — "Hide {layer}" or "Show {layer}" depending on current
    /// state — matching ``vertexEditSnapToggleTitle``'s "imperative verb"
    /// convention.
    public func layerVisibilityActionTitle(_ layer: MapLayer) -> String {
        strings.string(
            isLayerVisible(layer) ? .mapLayersHideAction : .mapLayersShowAction,
            parameters: ["layer": layerName(layer)]
        )
    }

    public func layerLockActionTitle(_ layer: MapLayer) -> String {
        strings.string(
            isLayerLocked(layer) ? .mapLayersUnlockAction : .mapLayersLockAction,
            parameters: ["layer": layerName(layer)]
        )
    }
}
