import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureMap

/// Layer visibility (hiding a layer must hide its objects consistently in
/// both the render snapshot and the accessible list) and layer locking
/// (blocking select/drag/vertex-edit/resize-rotate/delete/duplicate) —
/// split out from `MapEditorViewModelTests.swift`, the same file-splitting
/// convention `MapEditorViewModelReshapingTests.swift` already established.
@MainActor
@Suite("Map editor view model — layer visibility and locking")
struct MapEditorViewModelLayersTests {
    private func tree(id: String = "tree-1", x: Double = 0, y: Double = 0, revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: x, y: y)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func square(
        id: String = "structure-1",
        category: GardenObjectCategory = .structure,
        revision: Int = 1
    ) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: category,
            geometry: .polygon([[
                Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
                Position(x: 0, y: 0),
            ]]),
            coordinateSpaceId: "space-1",
            label: "Shed",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(
        gateway: FakeMapGateway,
        gardenId: String = "garden-1",
        viewPreferences: MapViewPreferenceStore = InMemoryMapViewPreferenceStore()
    ) -> MapEditorViewModel {
        let localStore = InMemoryMapStore()
        return MapEditorViewModel(
            gardenId: gardenId,
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: localStore),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: localStore, profileId: "profile-1"),
            listGardenPlanMedia: ListGardenPlanMedia(gateway: FakeMapMediaGateway()),
            loadPlanBackgroundImage: LoadPlanBackgroundImage(gateway: FakeMapMediaGateway()),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB")),
            viewPreferences: viewPreferences
        )
    }

    private func renderedIds(_ model: MapEditorViewModel) -> [String] {
        guard case let .loaded(snapshot) = model.state else { return [] }
        return snapshot.objects.map(\.id)
    }

    // MARK: - Visibility

    @Test("Hiding a layer removes its objects from the render snapshot and the accessible list, consistently")
    func hidingALayerHidesItsObjectsEverywhere() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]))
        await model.load()

        #expect(renderedIds(model).sorted() == ["structure-1", "tree-1"])
        #expect(model.accessibleRows.map(\.id).sorted() == ["structure-1", "tree-1"])

        model.toggleLayerVisibility(.plantsAndAnnotations)

        #expect(renderedIds(model) == ["structure-1"])
        #expect(model.accessibleRows.map(\.id) == ["structure-1"])
    }

    @Test("Showing a previously hidden layer restores its objects")
    func showingALayerAgainRestoresItsObjects() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]))
        await model.load()

        model.toggleLayerVisibility(.plantsAndAnnotations)
        #expect(renderedIds(model) == ["structure-1"])

        model.toggleLayerVisibility(.plantsAndAnnotations)

        #expect(renderedIds(model).sorted() == ["structure-1", "tree-1"])
        #expect(model.accessibleRows.map(\.id).sorted() == ["structure-1", "tree-1"])
    }

    // MARK: - Locking: select

    @Test("A locked layer's object cannot be selected via a canvas tap")
    func lockedLayerBlocksCanvasSelection() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))
        model.toggleLayerLock(.plantsAndAnnotations)

        let screenPoint = model.transform.screenPoint(for: Position(x: 0, y: 0))
        await model.handleCanvasTap(atScreen: screenPoint)

        #expect(model.selectedObjectId == nil)
    }

    @Test("An unlocked layer's object can still be selected while a different layer is locked")
    func unlockedLayerStillSelectableWhileAnotherIsLocked() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]))
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))
        model.toggleLayerLock(.plantsAndAnnotations)

        let screenPoint = model.transform.screenPoint(for: Position(x: 5, y: 5))
        await model.handleCanvasTap(atScreen: screenPoint)

        #expect(model.selectedObjectId == "structure-1")
    }

    @Test("A locked layer's object cannot be selected via the accessible list")
    func lockedLayerBlocksListSelection() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()
        model.toggleLayerLock(.plantsAndAnnotations)

        model.selectFromList("tree-1")

        #expect(model.selectedObjectId == nil)
        #expect(model.propertySheetObjectId == nil)
    }

    // MARK: - Locking: drag

    @Test("A locked layer's object cannot be dragged")
    func lockedLayerBlocksDrag() async {
        let gateway = FakeMapGateway(objects: [tree(x: 0, y: 0)])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.toggleLayerLock(.plantsAndAnnotations)

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 100, height: 0))

        #expect(gateway.submittedCommands.isEmpty)
        guard case let .point(position)? = model.objectsById["tree-1"]?.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        #expect(position == Position(x: 0, y: 0))
    }

    // MARK: - Locking: vertex-edit

    @Test("A locked layer's object cannot enter vertex-edit mode")
    func lockedLayerBlocksVertexEdit() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [square()]))
        await model.load()
        model.toggleLayerLock(.lotAndStructures)

        model.beginVertexEdit(objectId: "structure-1")

        #expect(model.vertexEditObjectId == nil)
    }

    // MARK: - Locking: resize/rotate

    @Test("A locked layer's object cannot be resized")
    func lockedLayerBlocksResize() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.toggleLayerLock(.lotAndStructures)

        await model.commitResize(objectId: "structure-1", factor: 2)

        #expect(gateway.submittedCommands.isEmpty)
    }

    @Test("A locked layer's object cannot be rotated")
    func lockedLayerBlocksRotate() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.toggleLayerLock(.lotAndStructures)

        await model.commitRotate(objectId: "structure-1", degrees: 90)

        #expect(gateway.submittedCommands.isEmpty)
    }

    // MARK: - Locking: delete

    @Test("A locked layer's object cannot be deleted")
    func lockedLayerBlocksDelete() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.toggleLayerLock(.plantsAndAnnotations)

        await model.delete(objectId: "tree-1")

        #expect(gateway.submittedCommands.isEmpty)
        #expect(model.objectsById["tree-1"]?.lifecycleState == .active)
    }

    // MARK: - Locking: duplicate

    @Test("A locked layer's object cannot be duplicated")
    func lockedLayerBlocksDuplicate() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.toggleLayerLock(.plantsAndAnnotations)

        await model.duplicate(objectId: "tree-1")

        #expect(gateway.submittedCommands.isEmpty)
        #expect(renderedIds(model) == ["tree-1"])
    }

    /// This asserted the opposite until using the map on a phone showed what
    /// it cost: `load()` cleared both sets, so every reload — entering the
    /// tab, saving a georeference, accepting a plat — brought back every layer
    /// a person had hidden, and the control read as broken. The sets are now a
    /// remembered preference; see ``MapViewPreferences``.
    @Test("Reloading the document leaves hidden and locked layers alone, unlike the selection state beside them")
    func loadKeepsVisibilityAndLocking() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.toggleLayerVisibility(.plantsAndAnnotations)
        model.toggleLayerLock(.plantsAndAnnotations)

        await model.load()

        #expect(!model.isLayerVisible(.plantsAndAnnotations))
        #expect(model.isLayerLocked(.plantsAndAnnotations))
    }

    // MARK: - Toggling back

    @Test("Unlocking a layer restores every gated interaction")
    func unlockingRestoresInteraction() async {
        let gateway = FakeMapGateway(objects: [tree(x: 0, y: 0)])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.toggleLayerLock(.plantsAndAnnotations)
        model.toggleLayerLock(.plantsAndAnnotations)

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 100, height: 0))

        // The offline commit path never touches the gateway (P5-IOS-02); the
        // interaction actually completing is what proves it was not blocked.
        #expect(gateway.submittedCommands.isEmpty)
        #expect(model.saveStatus == .savedLocally)
    }

    // MARK: - Remembering

    /// The defect this covers: anything that reloads the map — entering the
    /// tab, saving a georeference, accepting a plat — used to bring every
    /// hidden layer back, because `load()` cleared both sets.
    @Test("A hidden layer stays hidden across a reload")
    func hiddenLayerSurvivesAReload() async {
        let gateway = FakeMapGateway(objects: [tree(), square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.toggleLayerVisibility(.plantsAndAnnotations)
        #expect(renderedIds(model) == ["structure-1"])

        await model.load()

        #expect(model.isLayerVisible(.plantsAndAnnotations) == false)
        #expect(renderedIds(model) == ["structure-1"])
    }

    /// And across the editor being built again, which is what switching tabs
    /// actually does — a fresh view model reading the same store.
    @Test("A hidden layer stays hidden in the next editor for that garden")
    func hiddenLayerSurvivesANewEditor() async {
        let preferences = InMemoryMapViewPreferenceStore()
        let first = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]), viewPreferences: preferences)
        await first.load()
        first.toggleLayerVisibility(.plantsAndAnnotations)
        first.toggleLayerLock(.lotAndStructures)

        let second = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]), viewPreferences: preferences)
        await second.load()

        #expect(second.isLayerVisible(.plantsAndAnnotations) == false)
        #expect(second.isLayerLocked(.lotAndStructures))
        #expect(renderedIds(second) == ["structure-1"])
    }

    /// Kept per garden, so hiding the trees in one does not hide them in the
    /// next — the store is keyed, and a single shared bucket would be an easy
    /// and invisible mistake.
    @Test("Hiding a layer in one garden leaves another garden alone")
    func preferencesDoNotLeakBetweenGardens() async {
        let preferences = InMemoryMapViewPreferenceStore()
        let first = makeModel(
            gateway: FakeMapGateway(objects: [tree(), square()]),
            gardenId: "garden-1",
            viewPreferences: preferences
        )
        await first.load()
        first.toggleLayerVisibility(.plantsAndAnnotations)

        let other = makeModel(
            gateway: FakeMapGateway(objects: [tree(), square()]),
            gardenId: "garden-2",
            viewPreferences: preferences
        )
        await other.load()

        #expect(other.isLayerVisible(.plantsAndAnnotations))
        #expect(renderedIds(other).sorted() == ["structure-1", "tree-1"])
    }

    // MARK: - The object's own hide and lock

    private func hiddenTree() -> GardenMapObject {
        GardenMapObject(
            id: "tree-1",
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            isHidden: true,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// The case that was invisible: the flag arrives from the SERVER, set on
    /// another client, and this one has to honour it. It did not — the two
    /// fields were dropped on decode, so an object hidden on a laptop was
    /// drawn on the phone.
    @Test("An object hidden on the server is not drawn here")
    func serverHiddenObjectIsNotDrawn() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [hiddenTree(), square()]))
        await model.load()

        #expect(renderedIds(model) == ["structure-1"])
    }

    /// But it stays in the accessible list. That list is the alternative to
    /// the canvas, not a second copy of it: a reader who cannot see the
    /// drawing still has to be able to reach the object and unhide it.
    @Test("A hidden object stays reachable in the accessible list")
    func hiddenObjectStaysInTheList() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [hiddenTree(), square()]))
        await model.load()

        #expect(model.accessibleRows.map(\.id).sorted() == ["structure-1", "tree-1"])
    }

    private func lockedTree() -> GardenMapObject {
        GardenMapObject(
            id: "tree-1",
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            isLocked: true,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// The object's own lock reaches every gated interaction, because they all
    /// go through the one predicate.
    @Test("An object locked on the server cannot be dragged, with no layer locked")
    func serverLockedObjectCannotBeDragged() async {
        let gateway = FakeMapGateway(objects: [lockedTree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 100, height: 0))

        guard case let .point(position)? = model.objectsById["tree-1"]?.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        #expect(position == Position(x: 0, y: 0))
    }

    /// Correcting a label must not quietly unhide the object.
    ///
    /// `changeProperties` states the whole property set, so a save that left
    /// the two flags out would send `false` for both. This is the test that
    /// says the defaults are read off the object rather than off the type.
    @Test("Saving a label leaves hide and lock alone")
    func savingALabelPreservesTheFlags() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [hiddenTree()]))
        await model.load()

        await model.saveProperties(objectId: "tree-1", label: "Older Oak", details: nil)

        #expect(model.objectsById["tree-1"]?.isHidden == true)
        #expect(model.objectsById["tree-1"]?.label == "Older Oak")
    }

    @Test("Hiding an object from the property sheet keeps its label and details")
    func hidingFromTheSheetKeepsTheRest() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree(), square()]))
        await model.load()

        await model.setObjectVisibility(objectId: "tree-1", isHidden: true, isLocked: false)

        #expect(model.objectsById["tree-1"]?.isHidden == true)
        #expect(model.objectsById["tree-1"]?.label == "Old Oak")
        #expect(renderedIds(model) == ["structure-1"])
    }
}
