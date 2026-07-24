import CorePersistence
import Foundation

/// Durable local storage for one captured/selected photo's raw bytes — never
/// held only in memory. `MediaUploadCoordinator.enqueue` writes here BEFORE
/// creating any `MediaTransfer` row or making any network call: architecture/
/// media-storage-and-processing.md, section "2. Principles" — "The only
/// local copy is never deleted before verified remote durability or
/// deliberate user discard" — presupposes the local copy exists durably in
/// the first place, which is exactly what a purely in-memory `Data` value
/// captured by a view model does not survive a crash or termination.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; implementation-plan.md work package P6-IOS-01.
public protocol LocalMediaFileStore: Sendable {
    /// Writes `data` for `localId` under `profileId`'s own media directory,
    /// atomically, and returns the file's URL. The write is synchronous and
    /// complete (the file is present on disk, not merely scheduled) by the
    /// time this call returns — the durability guarantee every caller
    /// depends on.
    func write(_ data: Data, localId: String, profileId: String, fileExtension: String) throws -> URL

    /// Removes the file at `url`, silently succeeding if it is already gone
    /// (a discard racing a background cleanup, or a retry of a partially
    /// failed discard). Called only once a transfer reaches `.retained`
    /// (server-confirmed durable) or the user deliberately discards it —
    /// never before, matching this type's own doc comment.
    func delete(at url: URL) throws

    /// A scratch file location for a temporary byte-range slice of an
    /// existing local file — what `MediaUploadCoordinator`'s resume-after-
    /// interruption path writes a partial-upload continuation to, since a
    /// background `URLSessionUploadTask` must read its body from a file, and
    /// cannot itself seek into an offset of a larger file. Deterministic per
    /// `localId` (not a fresh random name each call): at most one resume
    /// slice ever exists per transfer at a time, so `MediaUploadCoordinator`
    /// can clean it up afterward by recomputing this same URL and calling
    /// `delete(at:)`, with no extra bookkeeping of "which temp file did the
    /// last resume attempt create."
    func temporarySliceURL(localId: String) -> URL
}

/// `FileManager`-backed implementation. Applies iOS data protection to every
/// written file (architecture/ios-application-design.md, section
/// "17. Security and Privacy": "Sensitive files use iOS data protection") —
/// guarded to `#if os(iOS)` because `FileProtectionType`/the `.protectionKey`
/// file attribute is meaningless on the headless macOS target this package
/// also builds for (`Package.swift`'s own comment: "so the package builds
/// and tests headlessly ... no macOS product is shipped").
///
/// Always uses `FileManager.default`, not an injected instance — `FileManager`
/// does not conform to `Sendable`, so it cannot be a stored property of this
/// `Sendable` struct; every other `FileManager` use in this codebase
/// (`CorePersistence.LocalDatabase`/`ClientInstallationIdentityStore`) makes
/// the same choice for the same reason.
public struct FileManagerLocalMediaFileStore: LocalMediaFileStore {
    public init() {}

    public func write(_ data: Data, localId: String, profileId: String, fileExtension: String) throws -> URL {
        let directory = try mediaDirectory(profileId: profileId)
        let url = directory.appendingPathComponent("\(localId).\(fileExtension)")
        try data.write(to: url, options: .atomic)
        try applyProtection(to: url)
        return url
    }

    public func delete(at url: URL) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }

    public func temporarySliceURL(localId: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("media-upload-slice-\(localId)")
    }

    /// Sibling of `profiles/<profileId>/gardens.sqlite`
    /// (`CorePersistence.LocalDatabase.open`) — see that method's own doc
    /// comment for why this reuses its application-support root rather than
    /// re-deriving one.
    private func mediaDirectory(profileId: String) throws -> URL {
        let base = try LocalDatabase.applicationSupportDirectory()
        let directory = base.appendingPathComponent("profiles/\(profileId)/media", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func applyProtection(to url: URL) throws {
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }
}
