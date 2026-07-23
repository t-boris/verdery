import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureMap

@MainActor
@Suite("Map editor view model")
struct MapEditorViewModelTests {
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

    private func fence(
        id: String = "fence-1",
        points: [Position] = [Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10)],
        revision: Int = 1
    ) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .fence,
            geometry: .lineString(points),
            coordinateSpaceId: "space-1",
            label: "Back fence",
            categoryDetails: .fence(FenceDetails(fenceKind: .wood)),
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

    private func plant(id: String = "plant-1", assignedToObjectId: String? = nil, revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .plant,
            geometry: .point(Position(x: 1, y: 1)),
            coordinateSpaceId: "space-1",
            label: "Tomato",
            categoryDetails: .plant(
                PlantPlacementDetails(commonName: "Tomato", quantity: 1, assignedToObjectId: assignedToObjectId)
            ),
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func zone(id: String = "zone-1", revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .zone,
            geometry: .polygon([[
                Position(x: 20, y: 20), Position(x: 30, y: 20), Position(x: 30, y: 30), Position(x: 20, y: 30),
                Position(x: 20, y: 20),
            ]]),
            coordinateSpaceId: "space-1",
            label: "Vegetable patch",
            categoryDetails: .zone(ZoneDetails(zoneKind: .garden)),
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(gateway: FakeMapGateway) -> MapEditorViewModel {
        MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    private func renderedIds(_ model: MapEditorViewModel) -> [String] {
        guard case let .loaded(snapshot) = model.state else { return [] }
        return snapshot.objects.map(\.id)
    }

    @Test("load populates the render snapshot from the gateway's active objects")
    func loadPopulatesSnapshot() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        #expect(renderedIds(model) == ["tree-1"])
    }

    @Test("A gateway failure surfaces as a failed state, not a crash")
    func loadFailureSurfacesMessage() async {
        struct AlwaysFailingGateway: MapGateway {
            func getMap(gardenId: String) async throws -> GardenMapDocument {
                throw APIGatewayError.unexpectedStatus(500, correlationId: "x")
            }
            func submitCommand(gardenId: String, command: MapCommandPayload, idempotencyKey: String) async throws -> MapCommandResult {
                throw APIGatewayError.unexpectedStatus(500, correlationId: "x")
            }
        }

        let model = MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: AlwaysFailingGateway()),
            submitMapCommand: SubmitMapCommand(gateway: AlwaysFailingGateway()),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected a failed state")
            return
        }
    }

    @Test("Placing a new object selects it and opens its property sheet")
    func createSelectsAndOpensSheet() async {
        let gateway = FakeMapGateway()
        let model = makeModel(gateway: gateway)
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        model.beginCreatePlacement(.tree)
        await model.handleCanvasTap(atScreen: CGPoint(x: 200, y: 200))

        #expect(model.armedCreateCategory == nil)
        #expect(model.selectedObjectId != nil)
        #expect(model.propertySheetObjectId == model.selectedObjectId)
        #expect(renderedIds(model).count == 1)
    }

    @Test("A completed object drag commits exactly one moveObject command and updates the object's position")
    func dragCommitsMove() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 100, height: 0))

        #expect(gateway.submittedCommands.count == 1)
        guard case .moveObject = gateway.submittedCommands.first else {
            Issue.record("Expected exactly one moveObject command")
            return
        }

        guard case let .loaded(snapshot) = model.state, let moved = snapshot.objects.first else {
            Issue.record("Expected a loaded object")
            return
        }
        guard case let .point(position) = moved.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        // Positive screen-x translation moves east (+x) at zero rotation.
        #expect(position.x > 0)
        #expect(model.canUndo)
    }

    @Test("Delete removes the object from the canvas but keeps it in the accessible list with a restore action")
    func deleteKeepsListRowForRestore() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.delete(objectId: "tree-1")

        #expect(renderedIds(model).isEmpty)
        let row = model.accessibleRows.first { $0.id == "tree-1" }
        #expect(row?.isDeleted == true)
    }

    @Test("Restore brings a deleted object back onto the canvas")
    func restoreBringsObjectBack() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()
        await model.delete(objectId: "tree-1")

        await model.restore(objectId: "tree-1")

        #expect(renderedIds(model) == ["tree-1"])
        #expect(model.accessibleRows.first { $0.id == "tree-1" }?.isDeleted == false)
    }

    @Test("saveProperties submits label and details together and closes the sheet")
    func savePropertiesUpdatesLabelAndDetails() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.selectFromList("tree-1")

        await model.saveProperties(
            objectId: "tree-1",
            label: "New Name",
            details: .tree(TreeDetails(commonName: "Quercus"))
        )

        #expect(model.propertySheetObjectId == nil)
        guard case let .loaded(snapshot) = model.state, let updated = snapshot.objects.first else {
            Issue.record("Expected the updated object in the snapshot")
            return
        }
        #expect(updated.label == "New Name")
    }

    @Test("Undo reverts a move, and redo reapplies it")
    func undoRedoRoundTripThroughViewModel() async {
        let gateway = FakeMapGateway(objects: [tree(x: 0, y: 0)])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 100, height: 0))
        let movedX = position(of: "tree-1", in: model)!.x
        #expect(movedX != 0)

        #expect(model.canUndo)
        await model.undo()
        #expect(abs(position(of: "tree-1", in: model)!.x - 0) < 0.0001)
        #expect(model.canRedo)

        await model.redo()
        #expect(abs(position(of: "tree-1", in: model)!.x - movedX) < 0.0001)
    }

    @Test("A stale local revision fails the command without corrupting the undo stack")
    func staleRevisionSurfacesErrorWithoutRecordingUndo() async {
        let gateway = FakeMapGateway(objects: [tree(revision: 1)])
        let model = makeModel(gateway: gateway)
        await model.load()

        // Simulate a concurrent edit from elsewhere: bump the server's
        // revision without the view model knowing.
        _ = try? await gateway.submitCommand(
            gardenId: "garden-1",
            command: .changeProperties(ChangePropertiesPayload(objectId: "tree-1", expectedRevision: 1, label: "Elsewhere")),
            idempotencyKey: "external"
        )

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))

        #expect(model.errorMessage != nil)
        #expect(!model.canUndo)
    }

    private func position(of objectId: String, in model: MapEditorViewModel) -> Position? {
        guard case let .loaded(snapshot) = model.state,
            let object = snapshot.objects.first(where: { $0.id == objectId }),
            case let .point(position) = object.geometry
        else { return nil }
        return position
    }
}
