import CoreDomain
import CoreLocalization

/// Layer visibility and locking — client-only preferences
/// (architecture/map-rendering-and-editing.md, section "12. Layer Model":
/// "Layer visibility and opacity are user preferences. Domain objects do not
/// store arbitrary visual stacking..."), never submitted as a command, and kept
/// per garden on this device only — see ``MapViewPreferences``. They do not
/// travel to the web client, which keeps its own in `localStorage`, and that is
/// the owner's decision rather than an omission.
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
        rememberLayerPreferences()
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
        rememberLayerPreferences()
    }

    /// Writes both sets after every toggle rather than on the way out.
    ///
    /// There is no "on the way out" to rely on: this editor is a tab, and a tab
    /// is left by switching to another one, by backgrounding the app, or by the
    /// system ending the process — none of which this view model is told about.
    /// Two small `UserDefaults` writes per tap cost nothing next to a tap.
    private func rememberLayerPreferences() {
        viewPreferences.save(
            MapViewPreferences(hiddenLayers: hiddenLayers, lockedLayers: lockedLayers),
            gardenId: gardenId
        )
    }

    /// The shared "is this object off-limits to interaction right now"
    /// predicate every gated entry point (see this file's doc comment)
    /// checks before doing anything.
    func isObjectLocked(_ object: GardenMapObject) -> Bool {
        // Either lock is enough. The layer's is this device's own, the
        // object's is the server's and shared; asking for both would let a
        // deliberate per-object lock be undone by whoever last unlocked the
        // group. Every gated entry point listed above checks this one
        // predicate, so honouring the object's flag needed no other change.
        object.isLocked || lockedLayers.contains(MapLayer(category: object.category))
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
