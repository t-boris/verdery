import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The map editor's navigation-bar controls — split from `MapEditorView.swift`
/// purely to keep that file under this repository's 600-line rule, the same way
/// `MapCanvasView+Handles.swift` and `MapObjectPropertyView+Details.swift`
/// already split their own.
extension MapEditorView {
    var toolbarContent: some ToolbarContent {
        // `.primaryAction` (not `.navigationBarTrailing`, which is iOS-only —
        // unavailable even for the headless macOS build this package also
        // targets, see `Package.swift`'s doc comment) resolves to the
        // trailing navigation bar position on iOS and to a sensible position
        // on every other platform this target compiles for.
        ToolbarItemGroup(placement: .primaryAction) {
            saveStatusIndicator

            // Only shown once there is something to show — see
            // `MapValidationPresentation`'s doc comment for why
            // `model.validationSummary` is reliably empty against the real
            // API today; the button and its badge count become live the
            // moment that changes.
            if !model.validationSummary.isEmpty {
                Button {
                    isWarningsSheetPresented = true
                } label: {
                    Label(
                        model.warningsButtonTitle,
                        systemImage: model.hasValidationErrors ? "xmark.octagon.fill" : "exclamationmark.triangle.fill"
                    )
                }
                .accessibilityIdentifier("map.editor.warnings")
            }

            // Which backdrop, and where the garden is. Both are geography
            // rather than geometry: neither moves a vertex, and the second is
            // what makes the first mean anything.
            if model.georeference != nil {
                Button {
                    model.basemapStyle = model.basemapStyle == .imagery ? .standard : .imagery
                } label: {
                    Label(model.basemapButtonTitle, systemImage: model.basemapStyle.symbol)
                }
                .accessibilityIdentifier("map.editor.basemap")
            }

            if makeGeoreferenceModel != nil {
                Button {
                    isGeoreferencePresented = true
                } label: {
                    Label(
                        model.georeferenceButtonTitle,
                        systemImage: "globe.badge.chevron.backward"
                    )
                }
                .accessibilityIdentifier("map.editor.georeference")
            }

            // The plan-background panel (P6-PLAN iOS parity) — upload
            // management lives on the garden screen; this manages placement.
            Button {
                isBackgroundPanelPresented = true
            } label: {
                Label(model.backgroundsButtonTitle, systemImage: "doc.richtext")
            }
            .accessibilityIdentifier("map.editor.backgrounds")

            Button {
                isLayersSheetPresented = true
            } label: {
                Label(model.layersButtonTitle, systemImage: "square.3.layers.3d")
            }
            .accessibilityIdentifier("map.editor.layers")

            Button {
                Task { await model.undo() }
            } label: {
                Label(model.undoTitle, systemImage: "arrow.uturn.backward")
            }
            .disabled(!model.canUndo)
            .accessibilityIdentifier("map.editor.undo")

            Button {
                Task { await model.redo() }
            } label: {
                Label(model.redoTitle, systemImage: "arrow.uturn.forward")
            }
            .disabled(!model.canRedo)
            .accessibilityIdentifier("map.editor.redo")
        }
    }
}
