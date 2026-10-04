#if DEBUG && targetEnvironment(simulator)
import CoreDomain
import CoreLocalization
import CoreNetworking
import CorePersistence
import FeatureGardens
import Foundation
import SwiftUI

/// Simulator-only fixture for the native, offline-capable first-garden journey.
/// The view, view model, command, migrations, SQLite store, and outbox are real.
/// Only the remote list is empty; authentication and sync are outside this test.
struct FirstGardenUITestView: View {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-first-garden")
    }

    @State private var model: GardensListViewModel

    init() {
        let environment = ProcessInfo.processInfo.environment
        guard let runIdentifier = environment["VERDERY_UI_TEST_RUN_ID"],
              UUID(uuidString: runIdentifier) != nil else {
            fatalError("UI tests require an isolated UUID run identifier.")
        }
        let profileIdentifier = "ui-test-\(runIdentifier)"
        if ProcessInfo.processInfo.arguments.contains("--ui-test-reset") {
            LocalDatabase.deleteProfileStore(profileIdentifier: profileIdentifier)
        }
        do {
            let database = try LocalDatabase.open(profileIdentifier: profileIdentifier)
            let store = GRDBGardenStore(dbQueue: database)
            _model = State(initialValue: GardensListViewModel(
                listGardens: ListGardens(gateway: EmptyGardenUITestGateway(), localStore: store),
                createGarden: CreateGarden(localStore: store, profileId: profileIdentifier),
                strings: LocalizedStrings(locale: Locale(identifier: "en"))
            ))
        } catch {
            fatalError("Could not open the UI test database: \(error)")
        }
    }

    var body: some View {
        NavigationStack {
            GardensListView(model: model, onOpen: { _, _ in })
        }
    }
}

private struct EmptyGardenUITestGateway: GardenGateway {
    func list(cursor: String?) async throws -> GardenPage {
        GardenPage(items: [], nextCursor: nil)
    }

    func create(name: String, idempotencyKey: String) async throws -> Garden {
        throw URLError(.unsupportedURL)
    }

    func get(gardenId: String) async throws -> Garden {
        throw URLError(.unsupportedURL)
    }

    func rename(gardenId: String, name: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden {
        throw URLError(.unsupportedURL)
    }

    func archive(gardenId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden {
        throw URLError(.unsupportedURL)
    }

    func requestDeletion(gardenId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Garden {
        throw URLError(.unsupportedURL)
    }
}
#endif
