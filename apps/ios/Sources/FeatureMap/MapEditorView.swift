import CoreDomain
import SwiftUI

/// The map editor screen: the `Canvas`/`MapKit` layer and the accessible
/// object list as two equally real ways to reach the same objects, a create
/// toolbar, undo/redo, and the property sheet.
public struct MapEditorView: View {
    private enum Tab: Hashable { case canvas, list }

    @State private var model: MapEditorViewModel
    @State private var selectedTab: Tab = .canvas

    public init(model: MapEditorViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .toolbar { toolbarContent }
            .sheet(isPresented: isPropertySheetPresented) {
                if let object = model.propertySheetObject {
                    MapObjectPropertyView(
                        object: object,
                        objectsById: model.objectsById,
                        strings: model.strings,
                        assignablePlantTargets: model.assignablePlantTargets,
                        supportsVertexEdit: model.supportsVertexEdit(object),
                        canJoin: model.canJoin(object),
                        onSave: { label, details in
                            await model.saveProperties(objectId: object.id, label: label, details: details)
                        },
                        onDelete: { await model.delete(objectId: object.id) },
                        onRestore: { await model.restore(objectId: object.id) },
                        onDuplicate: { await model.duplicate(objectId: object.id) },
                        onAssignPlant: { target in await model.assignPlant(objectId: object.id, targetObjectId: target) },
                        onEditShape: {
                            model.beginVertexEdit(objectId: object.id)
                            selectedTab = .canvas
                        },
                        onBeginJoin: {
                            model.beginJoinSelection(objectId: object.id)
                            selectedTab = .canvas
                        },
                        onClose: { model.closePropertySheet() }
                    )
                }
            }
            .sheet(isPresented: isGatePickerPresented) {
                MapGateFencePickerView(
                    fences: model.availableFences,
                    strings: model.strings,
                    onSelect: { fenceObjectId in Task { await model.createGate(fenceObjectId: fenceObjectId) } },
                    onCancel: { model.cancelGateCreation() }
                )
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView(model.loadingMessage)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("map.editor.loading")

        case .loaded:
            loadedContent

        case let .failed(message):
            VStack(spacing: 12) {
                Text(message).accessibilityIdentifier("map.editor.failure")
                Button(model.retryTitle) { Task { await model.load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var loadedContent: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                Text(model.canvasTabTitle).tag(Tab.canvas)
                Text(model.listTabTitle).tag(Tab.list)
            }
            .pickerStyle(.segmented)
            .padding([.horizontal, .top], 8)
            .accessibilityIdentifier("map.editor.tabPicker")

            if let hint = model.createHint {
                cancellableHintBanner(hint, cancelTitle: model.cancelPlacingTitle, onCancel: { model.cancelCreatePlacement() })
                    .accessibilityIdentifier("map.editor.createHint")
            }

            if let hint = model.joinSelectionHint {
                cancellableHintBanner(hint, cancelTitle: model.joinCancelTitle, onCancel: { model.cancelJoinSelection() })
                    .accessibilityIdentifier("map.editor.joinHint")
            }

            if let errorMessage = model.errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("map.editor.error")
            }

            if model.undoIsBlocked {
                Text(model.undoUnavailableMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("map.editor.undoUnavailable")
            }

            switch selectedTab {
            case .canvas:
                canvasArea
                if model.vertexEditObjectId != nil {
                    vertexEditActionBar
                } else {
                    selectionBar
                }
            case .list:
                MapObjectListView(
                    rows: model.accessibleRows,
                    emptyMessage: model.listEmptyMessage,
                    deleteActionTitle: model.listDeleteActionTitle,
                    restoreActionTitle: model.listRestoreActionTitle,
                    onSelect: { model.selectFromList($0) },
                    onDelete: { objectId in Task { await model.delete(objectId: objectId) } },
                    onRestore: { objectId in Task { await model.restore(objectId: objectId) } }
                )
            }

            createToolbar
        }
    }

    /// A dismissible instructional banner — shared by the create-placement
    /// hint, the join-selection hint, and (below) the shape-edit action bar's
    /// own instructional line, so the three modal-ish canvas modes this view
    /// can be in all read as the same visual language.
    private func cancellableHintBanner(_ hint: String, cancelTitle: String, onCancel: @escaping () -> Void) -> some View {
        HStack {
            Text(hint).font(.footnote)
            Spacer()
            Button(cancelTitle, action: onCancel)
                .font(.footnote)
        }
        .padding(8)
        .background(Color.yellow.opacity(0.2))
    }

    private var canvasArea: some View {
        ZStack {
            if let georeference = model.georeference {
                MapBackgroundView(georeference: georeference)
            }

            if case let .loaded(snapshot) = model.state {
                MapCanvasView(
                    snapshot: snapshot,
                    transform: model.transform,
                    selectedObjectId: model.selectedObjectId,
                    vertexEditObjectId: model.vertexEditObjectId,
                    selectedVertexIndex: model.selectedVertexIndex,
                    onViewportSizeChange: { model.updateViewportSize($0) },
                    onTap: { point in Task { await model.handleCanvasTap(atScreen: point) } },
                    onPan: { model.pan(byScreenTranslation: $0) },
                    onObjectDragEnded: { objectId, translation in
                        Task { await model.handleObjectDragEnded(objectId: objectId, translationScreen: translation) }
                    },
                    onZoom: { factor, anchor in model.zoom(by: factor, around: anchor) },
                    onVertexTap: { objectId, index in model.selectVertex(objectId: objectId, index: index) },
                    onVertexDragEnded: { objectId, index, translation in
                        Task { await model.commitVertexMove(objectId: objectId, vertexIndex: index, translationScreen: translation) }
                    },
                    onMidpointTap: { objectId, beforeIndex in
                        Task { await model.commitVertexInsert(objectId: objectId, beforeIndex: beforeIndex) }
                    },
                    onResizeEnded: { objectId, factor in Task { await model.commitResize(objectId: objectId, factor: factor) } },
                    onRotateEnded: { objectId, degrees in Task { await model.commitRotate(objectId: objectId, degrees: degrees) } }
                )
            }
        }
        .accessibilityIdentifier("map.editor.canvas")
        // The canvas is a tap/drag surface with no meaningful VoiceOver
        // story of its own; `MapObjectListView` is the real accessible path
        // to every object, so VoiceOver is pointed there instead of at
        // individual, ungrouped shape hit-targets.
        .accessibilityElement(children: .ignore)
        .accessibilityHidden(true)
    }

    /// Shown instead of ``selectionBar`` while ``MapEditorViewModel/vertexEditObjectId``
    /// is set: the hint banner plus the actions that operate on whichever
    /// vertex handle is currently selected (`MapCanvasView`'s tap-to-select),
    /// and a "Done" action that exits vertex-edit mode.
    private var vertexEditActionBar: some View {
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

                Spacer()

                Button(model.vertexEditDoneTitle) { model.endVertexEdit() }
                    .accessibilityIdentifier("map.editor.vertexEdit.done")
            }
            .padding(8)
        }
    }

    @ViewBuilder
    private var selectionBar: some View {
        if model.selectedObjectId != nil {
            HStack {
                Button {
                    model.openPropertySheetForSelection()
                } label: {
                    Label(model.editSelectedTitle, systemImage: "pencil")
                }
                .accessibilityIdentifier("map.editor.editSelected")

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

    private var createToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text(model.createSectionTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                ForEach(model.creatableCategories) { category in
                    Button {
                        model.beginCreatePlacement(category)
                        selectedTab = .canvas
                    } label: {
                        Text(model.creatableCategoryName(category))
                    }
                    .buttonStyle(.bordered)
                    .tint(model.armedCreateCategory == category ? .accentColor : .secondary)
                    // A gate cannot be created without an existing fence to
                    // attach to (`GateDetails.fenceObjectId` is required) —
                    // disabled up front rather than only refusing after a tap.
                    .disabled(category == .gate && !model.hasFence)
                    .accessibilityIdentifier("map.editor.create.\(category.id)")
                }
            }
            .padding(8)
        }
    }

    private var toolbarContent: some ToolbarContent {
        // `.primaryAction` (not `.navigationBarTrailing`, which is iOS-only —
        // unavailable even for the headless macOS build this package also
        // targets, see `Package.swift`'s doc comment) resolves to the
        // trailing navigation bar position on iOS and to a sensible position
        // on every other platform this target compiles for.
        ToolbarItemGroup(placement: .primaryAction) {
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

    private var isPropertySheetPresented: Binding<Bool> {
        Binding(
            get: { model.propertySheetObjectId != nil },
            set: { isPresented in if !isPresented { model.closePropertySheet() } }
        )
    }

    private var isGatePickerPresented: Binding<Bool> {
        Binding(
            get: { model.pendingGateCreationScreenPoint != nil },
            set: { isPresented in if !isPresented { model.cancelGateCreation() } }
        )
    }
}
