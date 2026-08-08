import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The map editor's bottom bands — the selection, vertex-edit, draft and create
/// rows that sit under the canvas. Split from `MapEditorView.swift` purely to
/// keep that file under this repository's 600-line rule, the same way
/// `MapEditorView+Toolbar.swift` and `MapCanvasView+Handles.swift` already
/// split their own.
///
/// They belong together for a second reason: between them they decide how much
/// height the canvas is left with, and it was one of them quietly taking that
/// decision — a horizontal `ScrollView`, flexible on the axis it does not
/// scroll — that drew the create rail half under the console strip.
///
/// Module-internal rather than `private`, because `private` is a file scope in
/// Swift and `MapEditorView.swift` composes these.
extension MapEditorView {
    /// Shown instead of ``selectionBar`` while ``MapEditorViewModel/vertexEditObjectId``
    /// is set: the hint banner plus the actions that operate on whichever
    /// vertex handle is currently selected (`MapCanvasView`'s tap-to-select),
    /// and a "Done" action that exits vertex-edit mode.
    var vertexEditActionBar: some View {
        VStack(spacing: 0) {
            if let hint = model.vertexEditHint {
                Text(hint)
                    .font(.footnote)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.yellow.opacity(0.2))
                    .accessibilityIdentifier("map.editor.vertexEditHint")
            }
            HStack {
                Button(model.vertexEditRemoveTitle) {
                    Task { await model.commitRemoveSelectedVertex() }
                }
                .disabled(!model.canRemoveSelectedVertex)
                .accessibilityIdentifier("map.editor.vertexEdit.remove")

                if model.canSplitAtSelectedVertex {
                    Button(model.vertexEditSplitTitle) {
                        Task { await model.splitAtSelectedVertex() }
                    }
                    .accessibilityIdentifier("map.editor.vertexEdit.split")
                }

                // Arms/disarms snapping for the next vertex-handle drag only
                // — this app's touch-appropriate stand-in for the web
                // editor's Cmd/Option-click modifier. See
                // `MapEditorViewModel.isVertexDragSnapSuppressed`'s doc
                // comment.
                Button(model.vertexEditSnapToggleTitle) {
                    model.toggleVertexDragSnapSuppression()
                }
                .accessibilityIdentifier("map.editor.vertexEdit.snapToggle")

                Spacer()

                Button(model.vertexEditDoneTitle) { model.endVertexEdit() }
                    .accessibilityIdentifier("map.editor.vertexEdit.done")
            }
            .padding(8)
        }
    }

    @ViewBuilder
    var selectionBar: some View {
        if model.selectedObjectId != nil {
            HStack {
                Button {
                    model.openPropertySheetForSelection()
                } label: {
                    Label(model.editSelectedTitle, systemImage: "pencil")
                }
                .accessibilityIdentifier("map.editor.editSelected")

                // The calibration entry for a selected plan background —
                // disabled (never hidden) while its display image is not
                // resolved, since a session needs plan points to tap.
                if model.selectedObject?.category == .importedBackground {
                    Button {
                        if let objectId = model.selectedObjectId {
                            model.beginCalibration(objectId: objectId)
                        }
                    } label: {
                        Label(model.calibrateSelectionTitle, systemImage: "scope")
                    }
                    .disabled(!model.canCalibrateSelection)
                    .accessibilityIdentifier("map.editor.calibrateSelected")
                }

                Spacer()

                Button(role: .destructive) {
                    Task { await model.deleteSelected() }
                } label: {
                    Label(model.deleteSelectedTitle, systemImage: "trash")
                }
                .accessibilityIdentifier("map.editor.deleteSelected")
            }
            .padding(8)
        }
    }

    /// Finish, undo a point, cancel — shown only while a shape is being
    /// drawn, and floating so the canvas keeps its height.
    @ViewBuilder
    var draftControls: some View {
        if model.isDrafting {
            HStack(spacing: Metrics.space3) {
                CompactActionButton(
                    symbol: "arrow.uturn.backward",
                    title: model.draftUndoTitle
                ) {
                    model.undoDraftPoint()
                }
                .accessibilityIdentifier("map.draft.undo")

                CompactActionButton(symbol: "xmark", title: model.draftCancelTitle) {
                    model.cancelDraft()
                }
                .accessibilityIdentifier("map.draft.cancel")

                Button(model.draftFinishTitle) {
                    Task { await model.finishDraft() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.canFinishDraft)
                .accessibilityIdentifier("map.draft.finish")
            }
            .padding(Metrics.space3)
        }
    }

    var createToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text(model.createSectionTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                ForEach(model.creatableCategories) { category in
                    createButton(category)
                }
            }
            .padding(8)
        }
        // A `ScrollView(.horizontal)` is still flexible VERTICALLY, so in the
        // stack above it competes with the canvas for leftover height instead
        // of asking for the one row it holds — and when the bands above it grow
        // (three banners can stack at once) what it gets is less than a button
        // is tall, which drew this rail cut in half under the console strip.
        // Fixing the vertical axis says what was always meant: the width
        // scrolls, the height is one row.
        .fixedSize(horizontal: false, vertical: true)
    }

    /// One category's button. Its own function because inlined in the `ForEach`
    /// above it puts the whole rail past what the type checker will solve in
    /// reasonable time — a compile error, not a preference.
    private func createButton(_ category: CreatableMapObjectCategory) -> some View {
        Button {
            model.beginDraft(category)
            selectedTab = .canvas
        } label: {
            Text(model.creatableCategoryName(category))
        }
        .buttonStyle(.bordered)
        .tint(model.armedCreateCategory == category ? .accentColor : .secondary)
        // A gate cannot be created without an existing fence to attach to
        // (`GateDetails.fenceObjectId` is required) — disabled up front rather
        // than only refusing after a tap.
        .disabled(category == .gate && !model.hasFence)
        .accessibilityIdentifier("map.editor.create.\(category.id)")
    }
}
