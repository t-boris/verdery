import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureMap

/// Gate creation, vertex-level reshape and resize/rotate, duplicate, plant
/// assignment, and split/join linework — split out from
/// `MapEditorViewModelTests.swift` to keep that file under this repository's
/// 600-line-per-file limit, matching how `MapEditorViewModelReshaping.swift`
/// itself already sits beside `MapEditorViewModel.swift` as its own
/// topic-scoped file. Fixture builders are duplicated locally rather than
/// shared with `MapEditorViewModelTests.swift`, the same choice
/// `MapEditorViewModelSnappingTests.swift` already made for the same reason.
@MainActor
@Suite("Map editor view model — reshape, duplicate, assign, split/join")
struct MapEditorViewModelReshapingTests {
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

    // MARK: - Task 1: gate creation requires an existing fence

    @Test("hasFence is false with no active fence and true once one exists")
    func hasFenceReflectsActiveFences() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()
        #expect(!model.hasFence)

        let withFence = makeModel(gateway: FakeMapGateway(objects: [tree(), fence()]))
        await withFence.load()
        #expect(withFence.hasFence)
    }

    @Test("Placing a gate with no fence in the garden surfaces an error and creates nothing")
    func gateCreationRefusedWithoutFence() async {
        let model = makeModel(gateway: FakeMapGateway())
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        model.beginCreatePlacement(.gate)
        await model.handleCanvasTap(atScreen: CGPoint(x: 200, y: 200))

        #expect(model.errorMessage != nil)
        #expect(model.pendingGateCreationScreenPoint == nil)
        #expect(renderedIds(model).isEmpty)
    }

    @Test("Placing a gate with a fence present opens the fence picker, and choosing a fence creates the gate")
    func gateCreationOpensPickerThenCreates() async {
        let gateway = FakeMapGateway(objects: [fence(id: "fence-1")])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        model.beginCreatePlacement(.gate)
        await model.handleCanvasTap(atScreen: CGPoint(x: 200, y: 200))

        #expect(model.pendingGateCreationScreenPoint != nil)
        #expect(model.availableFences.map(\.id) == ["fence-1"])

        await model.createGate(fenceObjectId: "fence-1")

        #expect(model.pendingGateCreationScreenPoint == nil)
        #expect(model.selectedObjectId != nil)

        let gateCommandDetails = gateway.submittedCommands.compactMap { command -> GateDetails? in
            guard case let .createObject(payload) = command, case let .gate(value)? = payload.categoryDetails else {
                return nil
            }
            return value
        }.first

        guard let details = gateCommandDetails else {
            Issue.record("Expected a createObject command carrying gate details")
            return
        }
        #expect(details.fenceObjectId == "fence-1")
    }

    // MARK: - Task 3: vertex-level reshape and resize/rotate

    @Test("Moving an ordinary polygon vertex submits editVertex and updates the geometry")
    func vertexMoveCommitsEditVertex() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        #expect(model.vertexEditObjectId == "structure-1")

        // Vertex 1 is (10, 0); a screen translation of (+100, 0) moves it
        // east by 5 metres at this test's default 20-points-per-metre scale.
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 1, translationScreen: CGSize(width: 100, height: 0))

        guard case .editVertex = gateway.submittedCommands.last else {
            Issue.record("Expected an editVertex command")
            return
        }
        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(abs(rings[0][1].x - 15) < 0.0001)
    }

    @Test("Moving a closed polygon ring's shared start/end vertex submits replaceGeometry and keeps the ring closed")
    func vertexMoveOnClosureVertexUsesReplaceGeometry() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 0, translationScreen: CGSize(width: 100, height: 0))

        guard case .replaceGeometry = gateway.submittedCommands.last else {
            Issue.record("Expected a replaceGeometry command")
            return
        }
        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(rings[0].first == rings[0].last)
    }

    @Test("Inserting a vertex adds one point at the tapped edge's midpoint")
    func vertexInsertAddsMidpoint() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        await model.commitVertexInsert(objectId: "structure-1", beforeIndex: 1)

        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(rings[0].count == 6)
        #expect(rings[0][1] == Position(x: 5, y: 0))
    }

    @Test("Removing the selected vertex submits editVertex(.remove) and drops one point")
    func vertexRemoveDropsSelectedVertex() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        model.selectVertex(objectId: "structure-1", index: 1)
        #expect(model.canRemoveSelectedVertex)

        await model.commitRemoveSelectedVertex()

        #expect(model.selectedVertexIndex == nil)
        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(rings[0].count == 4)
    }

    @Test("Resizing a polygon submits replaceGeometry with every vertex scaled around the centroid")
    func resizeScalesAroundCentroid() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [square()]))
        await model.load()

        await model.commitResize(objectId: "structure-1", factor: 2)

        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        // Centroid (5, 5); doubling produces corners at -5 and 15.
        #expect(rings[0][0] == Position(x: -5, y: -5))
        #expect(rings[0][2] == Position(x: 15, y: 15))
    }

    @Test("Rotating a polygon by 360 degrees reproduces the original geometry")
    func rotateByFullCircleIsIdentity() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [square()]))
        await model.load()
        let before = model.objectsById["structure-1"]!.geometry

        await model.commitRotate(objectId: "structure-1", degrees: 360)

        guard case let .polygon(afterRings)? = model.objectsById["structure-1"]?.geometry,
            case let .polygon(beforeRings) = before
        else {
            Issue.record("Expected polygon geometry")
            return
        }
        for (a, b) in zip(afterRings[0], beforeRings[0]) {
            #expect(abs(a.x - b.x) < 0.0001)
            #expect(abs(a.y - b.y) < 0.0001)
        }
    }

    // MARK: - Task 4: duplicate

    @Test("Duplicating an object creates a new one offset from the source and selects it")
    func duplicateCreatesOffsetCopy() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        await model.duplicate(objectId: "tree-1")

        #expect(renderedIds(model).count == 2)
        #expect(model.selectedObjectId != nil)
        #expect(model.selectedObjectId != "tree-1")
        guard let newId = model.selectedObjectId, case let .point(position)? = model.objectsById[newId]?.geometry else {
            Issue.record("Expected the duplicate to exist with point geometry")
            return
        }
        #expect(position == Position(x: 1, y: 1))
    }

    @Test("Undoing a duplicate deletes the new object without touching the source")
    func undoDuplicateDeletesOnlyTheCopy() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        await model.duplicate(objectId: "tree-1")
        #expect(renderedIds(model).count == 2)
        #expect(model.canUndo)

        await model.undo()

        #expect(renderedIds(model) == ["tree-1"])
    }

    // MARK: - Task 5: assign plant

    @Test("assignablePlantTargets lists only active zone and bed objects")
    func assignablePlantTargetsListsZonesAndBeds() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [plant(), zone(), fence()]))
        await model.load()

        #expect(model.assignablePlantTargets.map(\.id) == ["zone-1"])
    }

    @Test("assignPlant submits a distinct assignPlant command and updates assignedToObjectId")
    func assignPlantSubmitsDistinctCommand() async {
        let gateway = FakeMapGateway(objects: [plant(), zone()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.assignPlant(objectId: "plant-1", targetObjectId: "zone-1")

        guard case .assignPlant = gateway.submittedCommands.last else {
            Issue.record("Expected an assignPlant command")
            return
        }
        guard case let .plant(details)? = model.objectsById["plant-1"]?.categoryDetails else {
            Issue.record("Expected plant details")
            return
        }
        #expect(details.assignedToObjectId == "zone-1")
    }

    // MARK: - Task 6: split and join linework

    @Test("Splitting a fence at an interior vertex replaces it with two new objects")
    func splitProducesTwoNewObjects() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                fence(points: [Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 20, y: 0)])
            ])
        )
        await model.load()

        model.beginVertexEdit(objectId: "fence-1")
        model.selectVertex(objectId: "fence-1", index: 1)
        #expect(model.canSplitAtSelectedVertex)

        await model.splitAtSelectedVertex()

        #expect(model.objectsById["fence-1"] == nil || model.objectsById["fence-1"]?.lifecycleState == .deleted)
        #expect(model.vertexEditObjectId == nil)
        #expect(renderedIds(model).count == 2)
        #expect(model.selectedObjectId != nil)
    }

    @Test("Joining two fences merges them into one new object")
    func joinMergesTwoFences() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                fence(id: "fence-a", points: [Position(x: 0, y: 0), Position(x: 10, y: 0)]),
                fence(id: "fence-b", points: [Position(x: 10, y: 0), Position(x: 20, y: 0)]),
            ])
        )
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        let objectA = model.objectsById["fence-a"]!
        #expect(model.canJoin(objectA))

        model.beginJoinSelection(objectId: "fence-a")
        #expect(model.pendingJoinFirstObjectId == "fence-a")

        // The second object's screen location does not need to be exact —
        // `hitTestObjectId` only needs to land on `fence-b`'s geometry, and
        // this test's transform places local (15, 0) well inside its line.
        let screenPoint = model.transform.screenPoint(for: Position(x: 15, y: 0))
        await model.handleCanvasTap(atScreen: screenPoint)

        #expect(model.pendingJoinFirstObjectId == nil)
        #expect(model.objectsById["fence-a"]?.lifecycleState == .deleted)
        #expect(model.objectsById["fence-b"]?.lifecycleState == .deleted)
        #expect(renderedIds(model).count == 1)
    }

    @Test("Tapping an object of a different category while joining rejects the join with an error")
    func joinRejectsIncompatibleCategory() async {
        let model = makeModel(
            gateway: FakeMapGateway(objects: [
                // A second fence is required for `canJoin(fence-a)` to be
                // true at all — positioned away from the tap point below so
                // it is not what gets hit.
                fence(id: "fence-a", points: [Position(x: 0, y: 0), Position(x: 10, y: 0)]),
                fence(id: "fence-b", points: [Position(x: 50, y: 50), Position(x: 60, y: 50)]),
                square(id: "structure-1"),
            ])
        )
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        model.beginJoinSelection(objectId: "fence-a")
        #expect(model.pendingJoinFirstObjectId == "fence-a")

        let screenPoint = model.transform.screenPoint(for: Position(x: 5, y: 5))
        await model.handleCanvasTap(atScreen: screenPoint)

        #expect(model.errorMessage != nil)
        #expect(model.pendingJoinFirstObjectId == "fence-a")
    }
}
