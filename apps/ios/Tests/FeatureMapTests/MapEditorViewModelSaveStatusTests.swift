import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureMap

/// ``MapSaveStatus`` transitions — richer, persistent presentation of the
/// same outcome `isSubmitting`/`errorMessage` already track. Split out from
/// `MapEditorViewModelTests.swift`, the same file-splitting convention
/// `MapEditorViewModelReshapingTests.swift`/`MapEditorViewModelLayersTests.swift`
/// already established.
@MainActor
@Suite("Map editor view model — save status")
struct MapEditorViewModelSaveStatusTests {
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

    private func makeModel(gateway: FakeMapGateway) -> MapEditorViewModel {
        MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("saveStatus starts idle, before any command has been submitted")
    func startsIdle() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        #expect(model.saveStatus == .idle)
    }

    @Test("A successful command settles saveStatus to saved")
    func successfulCommandSettlesToSaved() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))

        #expect(model.saveStatus == .saved)
    }

    @Test("A rejected command sets saveStatus to failed and it persists — unlike errorMessage, a later unrelated read does not clear it")
    func rejectedCommandPersistsAsFailed() async {
        let gateway = FakeMapGateway(objects: [tree(revision: 1)])
        let model = makeModel(gateway: gateway)
        await model.load()

        // Simulate a concurrent edit from elsewhere, forcing this view
        // model's next command to fail on a stale `expectedRevision` — the
        // same setup `MapEditorViewModelTests.staleRevisionSurfacesErrorWithoutRecordingUndo`
        // uses.
        _ = try? await gateway.submitCommand(
            gardenId: "garden-1",
            command: .changeProperties(ChangePropertiesPayload(objectId: "tree-1", expectedRevision: 1, label: "Elsewhere")),
            idempotencyKey: "external"
        )

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))

        #expect(model.saveStatus == .failed)

        // An unrelated, non-submitting interaction must not silently clear
        // the "not saved" state.
        model.beginCreatePlacement(.tree)
        model.cancelCreatePlacement()

        #expect(model.saveStatus == .failed)
    }

    @Test("Once a later command succeeds, saveStatus moves on from failed to saved")
    func laterSuccessClearsFailedStatus() async {
        let gateway = FakeMapGateway(objects: [tree(revision: 1)])
        let model = makeModel(gateway: gateway)
        await model.load()

        _ = try? await gateway.submitCommand(
            gardenId: "garden-1",
            command: .changeProperties(ChangePropertiesPayload(objectId: "tree-1", expectedRevision: 1, label: "Elsewhere")),
            idempotencyKey: "external"
        )
        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))
        #expect(model.saveStatus == .failed)

        // Reload to pick up the real current revision, then submit a command
        // that actually succeeds.
        await model.load()
        await model.duplicate(objectId: "tree-1")

        #expect(model.saveStatus == .saved)
    }
}
