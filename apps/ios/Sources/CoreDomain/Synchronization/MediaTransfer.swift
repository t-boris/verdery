import Foundation

/// A local media file's transfer lifecycle.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer": `captured → registered → queued → uploading → verifying →
/// retained/deleted`, with a `failed/recoverable` branch reachable from
/// `uploading` or `verifying`.
public enum MediaTransferState: String, Equatable, Sendable, CaseIterable, Codable {
    case captured
    case registered
    case queued
    case uploading
    case verifying
    case retained
    case deleted
    case failed
    case recoverable
}

/// A reference to one locally captured media file and its transfer state —
/// never the binary content itself.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer" ("Transfer records contain the media identifier, local file
/// URL, checksum, byte count, upload session state, retry state, and server
/// ownership information"); architecture/offline-synchronization.md, section
/// "18. Media Coordination" ("Record sync contains media IDs and state, not
/// binary data").
public struct MediaTransfer: Equatable, Sendable, Identifiable, Codable {
    /// A client-generated UUIDv7 (architecture/data-and-geospatial-design.md,
    /// section "4. Identifier Strategy"), the same ID sent to the server on
    /// registration.
    public let id: String
    public let gardenId: String
    public let localFileUrl: String
    public let checksum: String?
    public let byteCount: Int64?
    public let state: MediaTransferState
    public let retryState: RetryState
    /// "Server ownership information": when the server verified and
    /// accepted this media as belonging to `gardenId`. `nil` until then.
    public let serverConfirmedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        localFileUrl: String,
        checksum: String? = nil,
        byteCount: Int64? = nil,
        state: MediaTransferState,
        retryState: RetryState = RetryState(),
        serverConfirmedAt: Date? = nil,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.localFileUrl = localFileUrl
        self.checksum = checksum
        self.byteCount = byteCount
        self.state = state
        self.retryState = retryState
        self.serverConfirmedAt = serverConfirmedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
