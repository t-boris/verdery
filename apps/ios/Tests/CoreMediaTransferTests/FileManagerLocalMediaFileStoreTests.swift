import Foundation
import Testing

@testable import CoreMediaTransfer

/// Real disk I/O, no fakes — this is exactly the durability property
/// P6-IOS-01's own completion criteria depend on: a captured photo's bytes
/// are actually present on disk, independent of any in-memory state,
/// immediately after `write` returns.
@Suite("FileManagerLocalMediaFileStore")
struct FileManagerLocalMediaFileStoreTests {
    private let profileId = "test-profile-\(UUID().uuidString)"

    @Test("write durably persists bytes to disk before returning")
    func writePersistsBytesToDisk() throws {
        let store = FileManagerLocalMediaFileStore()
        let data = Data("a real photo's bytes".utf8)

        let url = try store.write(data, localId: "local-1", profileId: profileId, fileExtension: "jpg")
        defer { try? store.delete(at: url) }

        #expect(FileManager.default.fileExists(atPath: url.path))
        #expect(try Data(contentsOf: url) == data)
    }

    @Test("write is idempotent-safe under the same localId — the second write replaces the first")
    func writeReplacesUnderSameLocalId() throws {
        let store = FileManagerLocalMediaFileStore()
        let firstURL = try store.write(Data("first".utf8), localId: "local-2", profileId: profileId, fileExtension: "jpg")
        let secondURL = try store.write(Data("second".utf8), localId: "local-2", profileId: profileId, fileExtension: "jpg")
        defer { try? store.delete(at: secondURL) }

        #expect(firstURL == secondURL)
        #expect(try Data(contentsOf: secondURL) == Data("second".utf8))
    }

    @Test("delete removes the file")
    func deleteRemovesFile() throws {
        let store = FileManagerLocalMediaFileStore()
        let url = try store.write(Data("bytes".utf8), localId: "local-3", profileId: profileId, fileExtension: "jpg")

        try store.delete(at: url)

        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test("delete is a silent no-op when the file is already gone")
    func deleteToleratesMissingFile() throws {
        let store = FileManagerLocalMediaFileStore()
        let url = try store.write(Data("bytes".utf8), localId: "local-4", profileId: profileId, fileExtension: "jpg")
        try store.delete(at: url)

        // A second delete of the same, already-gone file must not throw.
        try store.delete(at: url)
    }

    @Test("temporarySliceURL is deterministic per localId")
    func temporarySliceURLIsDeterministic() {
        let store = FileManagerLocalMediaFileStore()

        #expect(store.temporarySliceURL(localId: "abc") == store.temporarySliceURL(localId: "abc"))
        #expect(store.temporarySliceURL(localId: "abc") != store.temporarySliceURL(localId: "def"))
    }
}
