import CoreDomain
import CoreGraphics
import CoreLocalization
import Foundation
import Testing

@testable import FeatureMap

/// Vertex-drag snapping wired through `MapEditorViewModelReshaping.commitVertexMove`
/// — split out from `MapEditorViewModelTests.swift` to keep that file under
/// this repository's 600-line-per-file limit, matching how
/// `MapEditorViewModelReshaping.swift` itself already sits beside
/// `MapEditorViewModel.swift` as its own topic-scoped file.
@MainActor
@Suite("Map editor view model — vertex-drag snapping")
struct MapEditorViewModelSnappingTests {
    /// A 10x10 square (`structure-1`) at the origin, and a second object
    /// (`marker-1`, a lone point) placed exactly where dragging
    /// `structure-1`'s vertex 1 by (+0.05 m, 0 m) alone would land: (10.05,
    /// 0). Without snapping that small a move stays at (10.05, 0); with
    /// snapping enabled it should land exactly on `marker-1` at (10, 0).
    private func square(id: String = "structure-1", revision: Int = 1) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .structure,
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

    private func marker(id: String = "marker-1", at position: Position) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(position),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: 1,
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

    @Test("A vertex drag that lands near another object's vertex snaps onto it")
    func vertexDragSnapsOntoNearbyVertex() async {
        // At this test's default 20-points-per-metre scale, +1 screen point
        // is 0.05 m — small enough to land just short of (10, 0) but still
        // within the shared snap tolerance around it.
        let gateway = FakeMapGateway(objects: [square(), marker(at: Position(x: 10, y: 0))])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 1, translationScreen: CGSize(width: 1, height: 0))

        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(rings[0][1] == Position(x: 10, y: 0))
    }

    @Test("Toggling snap suppression skips snapping for exactly the next drag, then resets")
    func toggleSuppressesExactlyOneDrag() async {
        let gateway = FakeMapGateway(objects: [square(), marker(at: Position(x: 10, y: 0))])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        #expect(!model.isVertexDragSnapSuppressed)

        model.toggleVertexDragSnapSuppression()
        #expect(model.isVertexDragSnapSuppressed)

        // Suppressed: the small move must land exactly where the raw
        // translation puts it, not snapped onto the nearby marker.
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 1, translationScreen: CGSize(width: 1, height: 0))

        guard case let .polygon(firstRings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(abs(firstRings[0][1].x - 10.05) < 0.0001)
        #expect(!model.isVertexDragSnapSuppressed)

        // The suppression was consumed: this second drag, ending at the
        // same nearby marker, snaps normally.
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 1, translationScreen: CGSize(width: -1, height: 0))

        guard case let .polygon(secondRings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(secondRings[0][1] == Position(x: 10, y: 0))
    }

    @Test("Entering vertex-edit mode resets any suppression armed in a previous session")
    func beginningVertexEditResetsSuppression() async {
        let gateway = FakeMapGateway(objects: [square()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        model.toggleVertexDragSnapSuppression()
        #expect(model.isVertexDragSnapSuppressed)

        model.endVertexEdit()
        #expect(!model.isVertexDragSnapSuppressed)

        model.beginVertexEdit(objectId: "structure-1")
        #expect(!model.isVertexDragSnapSuppressed)
    }

    @Test("A closed ring's shared start/end vertex is snapped identically on both stored copies")
    func closureVertexDragSnapsBothCopies() async {
        // Vertex 0 is (0, 0); a screen translation of (+10, +10) moves it to
        // (0.5, -0.5) before snapping — close to, but not exactly at, this
        // marker, so a visible adjustment on both copies actually proves
        // snapping ran on the `replaceGeometry` path, not just the raw
        // translation.
        let gateway = FakeMapGateway(objects: [square(), marker(at: Position(x: 0.55, y: -0.45))])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.beginVertexEdit(objectId: "structure-1")
        await model.commitVertexMove(objectId: "structure-1", vertexIndex: 0, translationScreen: CGSize(width: 10, height: 10))

        guard case let .polygon(rings)? = model.objectsById["structure-1"]?.geometry else {
            Issue.record("Expected updated polygon geometry")
            return
        }
        #expect(rings[0].first == Position(x: 0.55, y: -0.45))
        #expect(rings[0].last == Position(x: 0.55, y: -0.45))
    }
}
