import CoreDomain
import Foundation

/// Durable, device-scoped storage for this app installation's
/// `clientInstallationId`.
///
/// `packages/api-contracts/openapi.yaml`, `PUT /sync/clients/{clientInstallationId}`'s
/// own description: "Client-generated UUIDv7. Stable for the lifetime of one
/// app installation on one device." Deliberately NOT a row in any per-profile
/// database `LocalDatabase.open` manages: `LocalDatabase.open(profileIdentifier:)`
/// scopes a whole SQLite file by Firebase UID (see that type's own doc
/// comment), so a value stored inside it would be re-generated on every
/// account switch on the same physical device — wrong for an identifier the
/// contract defines as "one device," not "one signed-in profile." No
/// existing storage in this codebase is device-scoped rather than
/// per-profile, so this is a new, deliberately minimal mechanism: one small
/// text file under the same `applicationSupportDirectory()`
/// `LocalDatabase` already resolves, but outside `profiles/`, so it survives
/// every profile switch and every database migration untouched.
///
/// Source: architecture/offline-synchronization.md, sections
/// "12. Initial Synchronization" (step 1), "22. Security" ("Device
/// installation identifiers are application-scoped and revocable");
/// implementation-plan.md work package P5-IOS-03.
public protocol ClientInstallationIdentityStore: Sendable {
    /// Returns this device's durable client installation id, generating and
    /// persisting a new one on first call. Every later call, including after
    /// a process relaunch, returns the same value.
    ///
    /// `async`, even though `FileClientInstallationIdentityStore`'s own work
    /// is plain synchronous file I/O: `InMemoryClientInstallationIdentityStore`
    /// (the fallback) is an actor, so its own conformance needs actor
    /// isolation for the `cached` value it mutates — the same reason every
    /// `Local*Store` protocol in this codebase is `async` even though
    /// `InMemoryGardenStore`'s own implementation touches no real I/O either.
    func currentOrGenerated() async throws -> String
}

public struct FileClientInstallationIdentityStore: ClientInstallationIdentityStore {
    private let fileURL: URL
    private let generate: @Sendable () -> String

    /// - Parameter fileURL: Overridable for tests, which point this at a
    ///   throwaway temporary file rather than the real application-support
    ///   directory. Defaults to `device/client-installation-id` under
    ///   `LocalDatabase.applicationSupportDirectory()`.
    public init(
        fileURL: URL? = nil,
        generate: @escaping @Sendable () -> String = UUIDv7.generate
    ) throws {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            self.fileURL = try LocalDatabase.applicationSupportDirectory()
                .appendingPathComponent("device", isDirectory: true)
                .appendingPathComponent("client-installation-id")
        }
        self.generate = generate
    }

    public func currentOrGenerated() async throws -> String {
        if let existing = try? String(contentsOf: fileURL, encoding: .utf8) {
            let trimmed = existing.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }

        let generated = generate()
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try generated.write(to: fileURL, atomically: true, encoding: .utf8)
        return generated
    }
}

/// Fallback used only when `FileClientInstallationIdentityStore.init`
/// throws (a read-only device volume, for example) — mirrors
/// `FeatureGardens.InMemoryGardenStore`'s identical role and reasoning. A
/// fresh id every time `currentOrGenerated()` is first called in a given
/// process, not durable across relaunch — an acceptable degradation for the
/// same reason `InMemoryGardenStore`'s own doc comment gives: only this
/// device's own persistence is lost, not synchronization correctness itself
/// (a new `clientInstallationId` just re-registers as a "new" installation
/// server-side next launch).
public actor InMemoryClientInstallationIdentityStore: ClientInstallationIdentityStore {
    private let generate: @Sendable () -> String
    private var cached: String?

    public init(generate: @escaping @Sendable () -> String = UUIDv7.generate) {
        self.generate = generate
    }

    public func currentOrGenerated() async throws -> String {
        if let cached { return cached }
        let generated = generate()
        cached = generated
        return generated
    }
}
