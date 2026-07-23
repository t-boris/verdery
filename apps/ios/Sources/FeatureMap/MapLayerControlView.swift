import CoreLocalization
import SwiftUI

/// Sheet listing every user-toggleable layer (``MapLayer``) with independent
/// visibility and lock controls — reachable from the map editor's toolbar.
/// See `MapEditorViewModelLayers.swift`'s doc comment for exactly what
/// locking blocks and why layers 1, 6, and 7 have no row here.
///
/// Every piece of data and every action is passed in already resolved,
/// matching `MapGateFencePickerView`'s and `MapObjectPropertyView`'s own
/// "closures in, no view-model reference" shape — this view has no idea a
/// `MapEditorViewModel` exists.
struct MapLayerControlView: View {
    let layers: [MapLayer]
    let strings: LocalizedStrings
    let name: (MapLayer) -> String
    let isVisible: (MapLayer) -> Bool
    let isLocked: (MapLayer) -> Bool
    let visibilityActionTitle: (MapLayer) -> String
    let lockActionTitle: (MapLayer) -> String
    let onToggleVisibility: (MapLayer) -> Void
    let onToggleLock: (MapLayer) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List(layers) { layer in
                row(for: layer)
            }
            .navigationTitle(strings(.mapLayersTitle))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(strings(.mapLayersClose), action: onClose)
                        .accessibilityIdentifier("map.layers.close")
                }
            }
        }
    }

    /// Two independent controls per row — visibility and lock — each its own
    /// button with an action-phrased accessibility label ("Hide {layer}",
    /// "Lock {layer}", ...) so VoiceOver announces what tapping it *does*,
    /// not just its current state. The plain-text layer name is hidden from
    /// the accessibility tree since both button labels already repeat it.
    private func row(for layer: MapLayer) -> some View {
        HStack {
            Text(name(layer))
                .accessibilityHidden(true)
            Spacer()
            Button {
                onToggleVisibility(layer)
            } label: {
                Image(systemName: isVisible(layer) ? "eye" : "eye.slash")
            }
            .accessibilityLabel(visibilityActionTitle(layer))
            .accessibilityIdentifier("map.layers.visibility.\(layer.id)")

            Button {
                onToggleLock(layer)
            } label: {
                Image(systemName: isLocked(layer) ? "lock.fill" : "lock.open")
            }
            .accessibilityLabel(lockActionTitle(layer))
            .accessibilityIdentifier("map.layers.lock.\(layer.id)")
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("map.layers.row.\(layer.id)")
    }
}
