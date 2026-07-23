import Foundation
import Synchronization
import Testing

@testable import CorePersistence

@Suite("Client installation identity store")
struct ClientInstallationIdentityStoreTests {
    private func temporaryFileURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("client-installation-id-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("client-installation-id")
    }

    @Test("Generates and persists a new id on first call")
    func generatesOnFirstCall() async throws {
        let fileURL = temporaryFileURL()
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }
        let store = try FileClientInstallationIdentityStore(fileURL: fileURL, generate: { "generated-id" })

        let id = try await store.currentOrGenerated()

        #expect(id == "generated-id")
        #expect(try String(contentsOf: fileURL, encoding: .utf8) == "generated-id")
    }

    @Test("Returns the same id on every later call, including from a fresh store instance (a process relaunch)")
    func returnsSameIdAcrossRelaunch() async throws {
        let fileURL = temporaryFileURL()
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }

        let firstStore = try FileClientInstallationIdentityStore(fileURL: fileURL, generate: { "first-generated-id" })
        let firstId = try await firstStore.currentOrGenerated()

        // A brand-new store instance, pointed at the same file — simulates a
        // process relaunch, since nothing but the file itself carries state
        // across one. Its own generator returns a distinguishable value, so
        // this only passes if the file, not this generator, is what wins.
        let secondStore = try FileClientInstallationIdentityStore(fileURL: fileURL, generate: { "second-generated-id" })
        let secondId = try await secondStore.currentOrGenerated()

        #expect(firstId == "first-generated-id")
        #expect(secondId == firstId)
    }

    @Test("InMemoryClientInstallationIdentityStore generates exactly once and caches for the rest of the process")
    func inMemoryFallbackCachesWithinProcess() async throws {
        let callCount = Mutex(0)
        let store = InMemoryClientInstallationIdentityStore(generate: {
            callCount.withLock { $0 += 1 }
            return "generated-id"
        })

        let first = try await store.currentOrGenerated()
        let second = try await store.currentOrGenerated()

        #expect(first == "generated-id")
        #expect(second == first)
        #expect(callCount.withLock { $0 } == 1)
    }
}
