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
        let localStore = InMemoryMapStore()
        return MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: localStore),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: localStore, profileId: "profile-1"),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    /// A `LocalMapStore` that can be toggled to fail every
    /// `commitOfflineMutation` call, delegating to a real `InMemoryMapStore`
    /// otherwise — lets a test force the local-commit failure path
    /// (`.failed`) and then a real subsequent success (`.savedLocally`)
    /// without needing a gateway at all, since P5-IOS-02's offline commit
    /// path never reaches one.
    private final class ToggleableLocalMapStore: LocalMapStore, @unchecked Sendable {
        private let inner = InMemoryMapStore()
        var shouldFail = false

        func fetchAll(gardenId: String) async throws -> [GardenMapObject] {
            try await inner.fetchAll(gardenId: gardenId)
        }

        func replaceAll(gardenId: String, with objects: [GardenMapObject]) async throws {
            try await inner.replaceAll(gardenId: gardenId, with: objects)
        }

        func commitOfflineMutation(
            gardenId: String,
            command: @Sendable (_ current: [String: GardenMapObject]) throws -> (
                projections: [GardenMapObject], operation: OutboxOperation
            )
        ) async throws -> [GardenMapObject] {
            guard !shouldFail else { throw MapCommandError.objectNotFound(objectId: "tree-1") }
            return try await inner.commitOfflineMutation(gardenId: gardenId, command: command)
        }

        func confirmSynced(objectId: String, revision: Int) async throws {
            try await inner.confirmSynced(objectId: objectId, revision: revision)
        }
    }

    @Test("saveStatus starts idle, before any command has been submitted")
    func startsIdle() async {
        let model = makeModel(gateway: FakeMapGateway(objects: [tree()]))
        await model.load()

        #expect(model.saveStatus == .idle)
    }

    @Test("A successful command settles saveStatus to savedLocally, with no gateway call")
    func successfulCommandSettlesToSavedLocally() async {
        let gateway = FakeMapGateway(objects: [tree()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))

        #expect(model.saveStatus == .savedLocally)
        #expect(gateway.submittedCommands.isEmpty)
    }

    @Test("A local commit failure sets saveStatus to failed and it persists — unlike errorMessage, a later unrelated read does not clear it")
    func localFailurePersistsAsFailed() async {
        let gateway = FakeMapGateway(objects: [tree(revision: 1)])
        let store = ToggleableLocalMapStore()
        let model = MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: store),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: store, profileId: "profile-1"),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
        await model.load()
        store.shouldFail = true

        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))

        #expect(model.saveStatus == .failed)

        // An unrelated, non-submitting interaction must not silently clear
        // the "not saved" state.
        model.beginCreatePlacement(.tree)
        model.cancelCreatePlacement()

        #expect(model.saveStatus == .failed)
    }

    @Test("Once a later command succeeds, saveStatus moves on from failed to savedLocally")
    func laterSuccessClearsFailedStatus() async {
        let gateway = FakeMapGateway(objects: [tree(revision: 1)])
        let store = ToggleableLocalMapStore()
        let model = MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: store),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: store, profileId: "profile-1"),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
        await model.load()

        store.shouldFail = true
        await model.handleObjectDragEnded(objectId: "tree-1", translationScreen: CGSize(width: 50, height: 0))
        #expect(model.saveStatus == .failed)

        store.shouldFail = false
        await model.duplicate(objectId: "tree-1")

        #expect(model.saveStatus == .savedLocally)
    }
}
