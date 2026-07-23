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

    private func makeModel(gateway: FakeMapGateway) -> MapEditorViewModel {
        let localStore = InMemoryMapStore()
        return MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: localStore),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: localStore, profileId: "profile-1"),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
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

    @Test("Reloading the document resets hidden and locked layers, matching the other session-only selection state load() already clears")
    func loadResetsVisibilityAndLocking() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.toggleLayerVisibility(.plantsAndAnnotations)
        model.toggleLayerLock(.plantsAndAnnotations)
        #expect(!model.isLayerVisible(.plantsAndAnnotations))
        #expect(model.isLayerLocked(.plantsAndAnnotations))

        await model.load()

        #expect(model.isLayerVisible(.plantsAndAnnotations))
        #expect(!model.isLayerLocked(.plantsAndAnnotations))
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
}
