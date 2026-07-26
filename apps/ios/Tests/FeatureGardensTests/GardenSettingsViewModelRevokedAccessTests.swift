import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureGardens

/// Covers `GardenSettingsViewModel.load()`'s handling of `garden.not_found` —
/// the response `GetGarden` receives once this profile's own membership on
/// the garden is revoked (architecture/identity-and-authorization.md,
/// section "9.1 Implemented garden evaluation": the same code names "no
/// active membership" as it names "no such garden").
///
/// Before this fix, a `garden.not_found` response arriving while this device
/// still had a CACHED copy of the garden (`hadCachedResult == true`) was
/// silently swallowed — `load()`'s `catch` branch only updated `state` when
/// `!hadCachedResult`. The screen kept showing its last-known summary
/// forever, with nothing telling the reader their access had changed: exactly
/// the "stale UI" P9A-IOS-01, item 7, asks this case to avoid. This suite
/// proves the fix: a `garden.not_found` response now always produces the
/// honest "you no longer have access" state, regardless of what was cached.
///
/// Local data removal itself (every `garden_object`/`plant`/`observation`/
/// `task` row, and the garden's own row) is proven separately and already
/// passing — see `GardenRevocationAttackTests` and
/// `CoreSynchronizationTests.RemoteSyncEnginePullTests
/// .gardenDeleteCascadesToEveryRegisteredApplier`. This suite is strictly
/// about the SCREEN'S reaction once that has already happened (or once any
/// other revocation producer ran) and this screen's own next network call
/// discovers it.
@Suite("Garden settings view model — revoked access")
@MainActor
struct GardenSettingsViewModelRevokedAccessTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func garden(id: String = "garden-1", name: String = "Backyard", revision: Int = 3) -> Garden {
        Garden(
            id: id, name: name, lifecycleState: .active, callerRole: .owner,
            revision: revision, createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(store: GRDBGardenStore, gateway: FakeGardenGatewayForAccept, gardenId: String = "garden-1") -> GardenSettingsViewModel {
        GardenSettingsViewModel(
            gardenId: gardenId,
            listGardens: ListGardens(gateway: gateway, localStore: store),
            getGarden: GetGarden(gateway: gateway, localStore: store),
            renameGarden: RenameGarden(localStore: store, profileId: "profile-1"),
            archiveGarden: ArchiveGarden(localStore: store, profileId: "profile-1"),
            requestGardenDeletion: RequestGardenDeletion(localStore: store, profileId: "profile-1"),
            strings: strings
        )
    }

    @Test("garden.not_found with no cached copy shows the honest revoked-access message")
    func revokedAccessWithNoCache() async throws {
        let store = GRDBGardenStore(dbQueue: try makeDatabase())
        let gateway = FakeGardenGatewayForAccept()
        gateway.errorToThrow = APIGatewayError.service(
            APIErrorBody(code: "garden.not_found", message: "fake", correlationId: "fake", retryable: false),
            statusCode: 404,
            retryAfterSeconds: nil
        )
        let model = makeModel(store: store, gateway: gateway)

        await model.load()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.collaborationRevokedAccessMessage))
        #expect(model.didLoseAccess)
    }

    @Test("garden.not_found with a cached copy STILL shows the revoked-access message — the fixed bug")
    func revokedAccessWithCachePresent() async throws {
        let store = GRDBGardenStore(dbQueue: try makeDatabase())
        try await store.save(garden())
        let gateway = FakeGardenGatewayForAccept()
        gateway.errorToThrow = APIGatewayError.service(
            APIErrorBody(code: "garden.not_found", message: "fake", correlationId: "fake", retryable: false),
            statusCode: 404,
            retryAfterSeconds: nil
        )
        let model = makeModel(store: store, gateway: gateway)

        await model.load()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed, not the stale cached .loaded state")
            return
        }
        #expect(message == strings(.collaborationRevokedAccessMessage))
        #expect(model.didLoseAccess)
    }

    @Test("A non-revocation service failure with a cached copy present leaves the cached summary displayed, unchanged")
    func genericFailureWithCacheKeepsShowingCachedSummary() async throws {
        let store = GRDBGardenStore(dbQueue: try makeDatabase())
        try await store.save(garden(name: "Cached Name"))
        let gateway = FakeGardenGatewayForAccept()
        gateway.errorToThrow = APIGatewayError.service(
            APIErrorBody(code: "server.internal", message: "fake", correlationId: "fake", retryable: true),
            statusCode: 500,
            retryAfterSeconds: nil
        )
        let model = makeModel(store: store, gateway: gateway)

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected .loaded, showing the cached summary")
            return
        }
        #expect(summary.name == "Cached Name")
        #expect(!model.didLoseAccess)
    }

    @Test("A non-revocation service failure with no cache shows the ordinary generic failure message")
    func genericFailureWithNoCache() async throws {
        let store = GRDBGardenStore(dbQueue: try makeDatabase())
        let gateway = FakeGardenGatewayForAccept()
        gateway.errorToThrow = APIGatewayError.service(
            APIErrorBody(code: "server.internal", message: "fake", correlationId: "fake", retryable: true),
            statusCode: 500,
            retryAfterSeconds: nil
        )
        let model = makeModel(store: store, gateway: gateway)

        await model.load()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.serverUnexpected))
        #expect(!model.didLoseAccess)
    }
}
