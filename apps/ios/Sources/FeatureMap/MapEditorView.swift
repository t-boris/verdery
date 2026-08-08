import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The map editor screen: the `Canvas`/`MapKit` layer and the accessible
/// object list as two equally real ways to reach the same objects, a create
/// toolbar, undo/redo, and the property sheet.
public struct MapEditorView: View {
    enum Tab: Hashable { case canvas, list }

    @State var model: MapEditorViewModel
    /// Module-internal for the same reason the sheet flags below are: the
    /// create rail lives in `MapEditorView+Bands.swift` and arming a tool
    /// returns the reader to the canvas.
    @State var selectedTab: Tab = .canvas
    @State var isLayersSheetPresented = false
    /// Module-internal, not `private`: `MapEditorView+Toolbar.swift` raises
    /// these sheets, and `private` is a file scope in Swift.
    @State var isWarningsSheetPresented = false
    @State var isBackgroundPanelPresented = false
    @State var isGeoreferencePresented = false
    /// Which uploaded plan is being read, if any. An identifier rather than a
    /// boolean, because the sheet needs to know which drawing.
    @State var readingPlanMediaId: PlanReadingRequest?
    @State var isAerialTracingPresented = false
    /// Honours the system Reduce Transparency setting; see ``scaleIndicator``.
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    /// The scale pill's own padding, scaled with the reader's text size so
    /// the capsule grows with the caption inside it instead of clipping it.
    @ScaledMetric(relativeTo: .caption2) private var scaleIndicatorPaddingHorizontal: CGFloat = 8
    @ScaledMetric(relativeTo: .caption2) private var scaleIndicatorPaddingVertical: CGFloat = 4
    /// Per-session dismiss for the non-survey disclosure banner. Resets the
    /// next time this screen is opened fresh (a new `MapEditorView`
    /// instance) — per the work package, "a per-session dismiss that
    /// reappears next launch is fine; it must not vanish permanently after
    /// one tap."
    @State private var isDisclosureDismissed = false

    /// Building the georeference screen. Optional, so a composition that
    /// wires no geography gateway simply omits the button rather than showing
    /// one that could only fail.
    let makeGeoreferenceModel: ((GardenGeoreference?) -> GeoreferenceViewModel)?
    /// Building the plat reader for one uploaded plan.
    let makePlatReadingModel: ((String) -> PlatReadingViewModel)?
    /// Building the aerial tracer. Absent where no geography gateway is wired,
    /// in which case the button is not drawn rather than drawn dead.
    let makeAerialTracingModel: (() -> AerialTracingViewModel)?

    public init(
        model: MapEditorViewModel,
        makeGeoreferenceModel: ((GardenGeoreference?) -> GeoreferenceViewModel)? = nil,
        makePlatReadingModel: ((String) -> PlatReadingViewModel)? = nil,
        makeAerialTracingModel: (() -> AerialTracingViewModel)? = nil
    ) {
        _model = State(wrappedValue: model)
        self.makeGeoreferenceModel = makeGeoreferenceModel
        self.makePlatReadingModel = makePlatReadingModel
        self.makeAerialTracingModel = makeAerialTracingModel
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .toolbar { toolbarContent }
            .sheet(item: $readingPlanMediaId) { request in
                if let makePlatReadingModel {
                    PlatReadingView(
                        model: makePlatReadingModel(request.planMediaId),
                        accept: { acceptance in
                            readingPlanMediaId = nil
                            Task { await model.acceptPlatReading(acceptance) }
                        },
                        close: { readingPlanMediaId = nil }
                    )
                }
            }
            .sheet(isPresented: $isAerialTracingPresented) {
                if let makeAerialTracingModel {
                    AerialTracingView(
                        model: makeAerialTracingModel(),
                        accept: { proposals in
                            isAerialTracingPresented = false
                            Task { await model.acceptAerialTracing(proposals) }
                        },
                        close: { isAerialTracingPresented = false }
                    )
                }
            }
            .sheet(isPresented: $isGeoreferencePresented) {
                if let makeGeoreferenceModel {
                    GeoreferenceView(model: makeGeoreferenceModel(model.georeference)) {
                        isGeoreferencePresented = false
                        // The backdrop and every geographic reading follow the
                        // anchor, so the document is re-read rather than
                        // patched: a georeference write is a separate revision
                        // and the map's own copy is now behind.
                        Task { await model.load() }
                    }
                }
            }
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
                        onSetVisibility: { hidden, locked in
                            await model.setObjectVisibility(objectId: object.id, isHidden: hidden, isLocked: locked)
                        },
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
            .sheet(isPresented: $isLayersSheetPresented) {
                MapLayerControlView(
                    layers: model.layers,
                    strings: model.strings,
                    name: { model.layerName($0) },
                    isVisible: { model.isLayerVisible($0) },
                    isLocked: { model.isLayerLocked($0) },
                    visibilityActionTitle: { model.layerVisibilityActionTitle($0) },
                    lockActionTitle: { model.layerLockActionTitle($0) },
                    onToggleVisibility: { model.toggleLayerVisibility($0) },
                    onToggleLock: { model.toggleLayerLock($0) },
                    onClose: { isLayersSheetPresented = false }
                )
            }
            .sheet(isPresented: $isBackgroundPanelPresented) {
                MapBackgroundPanelView(
                    model: model,
                    onClose: { isBackgroundPanelPresented = false },
                    readPlatAction: makePlatReadingModel == nil
                        ? nil
                        : { planMediaId in
                            isBackgroundPanelPresented = false
                            readingPlanMediaId = PlanReadingRequest(planMediaId: planMediaId)
                        }
                )
            }
            .sheet(isPresented: $isWarningsSheetPresented) {
                MapValidationSummaryView(
                    issues: model.validationSummary,
                    objectsById: model.objectsById,
                    strings: model.strings,
                    onSelectObject: { objectId in
                        model.selectFromList(objectId)
                        selectedTab = .canvas
                        isWarningsSheetPresented = false
                    },
                    onClose: { isWarningsSheetPresented = false }
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
            // A rail rather than a segmented `Picker`. The two draw the same
            // shape; the rail's type, tint and selected-state contrast are
            // this application's, and it names itself for VoiceOver rather
            // than needing a label hidden back in.
            SegmentedRail(
                fieldName: model.tabPickerLabel,
                options: [
                    SegmentedRail.Option(
                        value: Tab.canvas, label: model.canvasTabTitle, symbol: "map"
                    ),
                    SegmentedRail.Option(
                        value: Tab.list, label: model.listTabTitle, symbol: "list.bullet"
                    ),
                ],
                selection: $selectedTab
            )
            .padding([.horizontal, .top], Metrics.space2)
            .accessibilityIdentifier("map.editor.tabPicker")

            if !isDisclosureDismissed {
                nonSurveyDisclosureBanner
                    .accessibilityIdentifier("map.editor.disclosure")
            }

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
                // The one element in this stack that may give up height —
                // "the canvas is the workspace", and every band around it is
                // controls at their own natural size. Said explicitly, so that
                // a band which is accidentally flexible cannot win the space a
                // control needs: `createToolbar` was exactly that, and lost
                // half of itself under the console strip.
                canvasArea
                    .layoutPriority(-1)
                if model.calibrationDraft != nil {
                    MapCalibrationBarView(model: model)
                } else if model.vertexEditObjectId != nil {
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
                .layoutPriority(-1)
            }

            draftControls
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

    /// "Not a legal survey" disclosure — visible without the user seeking it
    /// out (the work package's own requirement), matching the visual weight
    /// of ``cancellableHintBanner`` but with its own neutral background,
    /// since this is a standing disclosure, not an instructional hint tied
    /// to a transient editing mode. Dismissible only for this session — see
    /// `isDisclosureDismissed`'s doc comment.
    private var nonSurveyDisclosureBanner: some View {
        HStack(alignment: .top) {
            Text(model.disclosureText).font(.footnote)
            Spacer()
            Button(model.disclosureDismissTitle) { isDisclosureDismissed = true }
                .font(.footnote)
                .accessibilityIdentifier("map.editor.disclosure.dismiss")
        }
        .padding(8)
        .background(Color.secondary.opacity(0.12))
    }

    private var canvasArea: some View {
        ZStack(alignment: .topLeading) {
            canvasSurface
            scaleIndicator
                .padding(8)
            // Trailing, so it never sits under the scale pill, and top so a
            // thumb reaching it does not cross the drawing.
            MapRotationControl(model: model)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private var canvasSurface: some View {
        ZStack {
            if let camera = model.basemapCamera {
                MapBackgroundView(camera: camera, style: model.basemapStyle)
            }

            if case let .loaded(snapshot) = model.state {
                MapCanvasView(
                    snapshot: snapshot,
                    backgroundLayers: model.backgroundLayers,
                    transform: model.transform,
                    selectedObjectId: model.selectedObjectId,
                    vertexEditObjectId: model.vertexEditObjectId,
                    selectedVertexIndex: model.selectedVertexIndex,
                    isVertexDragSnapSuppressed: model.isVertexDragSnapSuppressed,
                    draftScreenPoints: model.draftScreenPoints,
                    isDrafting: model.isDrafting,
                    onViewportSizeChange: { model.updateViewportSize($0) },
                    onTap: { point in
                        if model.isDrafting {
                            model.addDraftPoint(atScreen: point)
                        } else {
                            Task { await model.handleCanvasTap(atScreen: point) }
                        }
                    },
                    onTrace: { points in model.addDraftTrace(screenPoints: points) },
                    onPan: { model.pan(byScreenTranslation: $0) },
                    onObjectDragEnded: { objectId, translation in
                        Task { await model.handleObjectDragEnded(objectId: objectId, translationScreen: translation) }
                    },
                    onZoom: { factor, anchor in model.zoom(by: factor, around: anchor) },
                    onRotate: { degrees, anchor in model.rotate(by: degrees, around: anchor) },
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
        // One element with an honest description, rather than the silence
        // `.accessibilityHidden(true)` used to produce.
        //
        // Exposing the individual drawn shapes is still not the answer —
        // they are pixels in a `Canvas`, not views, and `MapObjectListView`
        // is the real accessible path to every object. But a surface that
        // simply does not exist for VoiceOver gives a reader no way to learn
        // that the alternative exists, or that drawing and dragging are
        // genuinely touch-only in this pass. The label says both.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.canvasAccessibilityLabel)
    }

    /// A small, always-accessible pill reading the garden's scale/accuracy
    /// state — deliberately a sibling of ``canvasSurface``, not nested
    /// inside it, so `canvasSurface`'s own `.accessibilityElement(children:
    /// .ignore)` never swallows it. See `MapScalePresentation`'s doc comment.
    private var scaleIndicator: some View {
        Text(model.scaleIndicatorText)
            .font(.caption2)
            .padding(.horizontal, scaleIndicatorPaddingHorizontal)
            .padding(.vertical, scaleIndicatorPaddingVertical)
            // The pill sits over the canvas, so its backing has to keep the
            // text legible against whatever is drawn beneath it. A blur does
            // that for most readers; a reader who has turned Reduce
            // Transparency on has asked not to be given one, and gets an
            // opaque backing instead — which is the stronger contrast anyway.
            .background(
                reduceTransparency
                    ? AnyShapeStyle(.background)
                    : AnyShapeStyle(.ultraThinMaterial),
                in: Capsule()
            )
            .accessibilityIdentifier("map.editor.scaleIndicator")
    }

    /// A small, persistent save-status indicator — distinct from
    /// `model.errorMessage`'s existing one-shot banner (still shown
    /// separately above). Renders nothing for `.idle`, so the toolbar stays
    /// uncluttered when there is nothing to report.
    @ViewBuilder
    var saveStatusIndicator: some View {
        switch model.saveStatus {
        case .idle:
            EmptyView()

        case .saving:
            HStack(spacing: 4) {
                ProgressView().controlSize(.small)
                Text(model.saveStatusSavingText).font(.caption)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(model.saveStatusSavingText)
            .accessibilityIdentifier("map.editor.saveStatus.saving")

        case .savedLocally:
            Label(model.saveStatusSavedLocallyText, systemImage: "checkmark.icloud")
                .font(.caption)
                .accessibilityIdentifier("map.editor.saveStatus.savedLocally")

        case .saved:
            Label(model.saveStatusSavedText, systemImage: "checkmark.circle.fill")
                .font(.caption)
                .accessibilityIdentifier("map.editor.saveStatus.saved")

        case .failed:
            Label(model.saveStatusFailedText, systemImage: "exclamationmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .accessibilityIdentifier("map.editor.saveStatus.failed")
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
