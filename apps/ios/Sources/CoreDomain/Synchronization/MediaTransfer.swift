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
/// Extended in P6-IOS-01 with the fields a real `CoreMediaTransfer
/// .MediaUploadCoordinator` needs to drive registration, resumable upload,
/// and recovery end to end: this row was originally scaffolded in P5-IOS-01
/// with no real caller (see `CoreSynchronization.SyncEngineStatus`'s own doc
/// comment, written before this stage, for the honest "no media-upload flow
/// calls it yet" state of the codebase this type inherits). `id` is now
/// documented accurately: `packages/api-contracts/openapi.yaml`'s
/// `RegisterMediaUploadRequest` has no client-suppliable id field at all —
/// the server always mints `Media.id` itself — so `id` here is this row's
/// own LOCAL identity (stable across the whole local lifecycle, generated
/// the moment a file is durably written, before any network call), and
/// `mediaId` below is the separate, server-assigned identity, `nil` until
/// registration succeeds. The two are never the same value; conflating them
/// was this type's own pre-existing inaccuracy, corrected here rather than
/// carried forward.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer" ("Transfer records contain the media identifier, local file
/// URL, checksum, byte count, upload session state, retry state, and server
/// ownership information"); architecture/offline-synchronization.md, section
/// "18. Media Coordination" ("Record sync contains media IDs and state, not
/// binary data"); architecture/media-storage-and-processing.md, sections
/// "6. Upload State Machine", "7. Upload Flow".
public struct MediaTransfer: Equatable, Sendable, Identifiable, Codable {
    /// Client-generated UUIDv7, this row's own local identity — stable from
    /// the moment the captured/selected file is durably written to disk,
    /// independent of whether registration has happened yet.
    public let id: String
    public let gardenId: String
    public let localFileUrl: String
    public let checksum: String?
    public let byteCount: Int64?
    public let state: MediaTransferState
    public let retryState: RetryState
    /// "Server ownership information": when the server verified and
    /// accepted this media as belonging to `gardenId` (`uploadState ==
    /// .available`, set once `CompleteMediaUpload` succeeds). `nil` until
    /// then.
    public let serverConfirmedAt: Date?
    public let createdAt: Date
    public let updatedAt: Date

    /// What `RegisterMediaUpload`'s request declares — captured at the
    /// moment the file is durably written, so registration can be retried
    /// (or resumed after a relaunch) from this row alone, with no dependency
    /// on any in-memory state.
    public let mediaClass: MediaClass
    public let displayFilename: String
    public let declaredContentType: String
    public let declaredByteSize: Int64

    /// The server-assigned media id — `nil` until `RegisterMediaUpload`
    /// succeeds. See this type's own doc comment for why this, not `id`, is
    /// the identifier every other `Media` endpoint (`GetMediaStatus`,
    /// `CompleteMediaUpload`, `GetMediaAccess`) addresses.
    public let mediaId: String?
    /// The resumable upload session URI `RegisterMediaUpload` returned.
    /// `nil` until registration succeeds; replaced (never patched) if this
    /// transfer is ever re-registered under a fresh idempotency key — see
    /// `MediaUploadCoordinator`'s own doc comment on session expiry.
    public let uploadUrl: String?
    public let uploadUrlExpiresAt: Date?
    /// `Media.revision` as of the most recent registration/status read —
    /// what `CompleteMediaUpload`'s required `If-Match` precondition sends.
    public let mediaRevision: Int?
    /// Bytes confirmed sent to Cloud Storage as of the most recent
    /// `URLSessionTaskDelegate` progress callback this row was persisted
    /// under — what a progress UI renders, and what a resumed upload can use
    /// as a starting estimate before this device's own authoritative
    /// GCS-status-check confirms the real offset.
    public let bytesSent: Int64
    /// The most recently observed `Media.uploadState`/`processingState` —
    /// raw wire values, not re-typed as `CoreDomain.MediaUploadState`/
    /// `MediaProcessingState` here: a GRDB row is a passive cache of the
    /// last read, and storing the same raw string a decode already produced
    /// avoids a second enum roundtrip on every write for a value this row
    /// never itself branches on (only `MediaTransferState` — the LOCAL
    /// lifecycle — drives this type's own behavior).
    public let serverUploadState: String?
    public let serverProcessingState: String?
    /// A safe, non-technical reason code set when `state == .failed` or
    /// `.recoverable` — a `CoreDomain.SyncErrorCategory` raw value for a
    /// classified gateway failure, or `"rejected"`/the server's own
    /// `APIErrorBody.code` for an explicit terminal outcome. Never a raw
    /// exception message, matching this codebase's "no raw provider
    /// responses" logging rule (architecture/ios-application-design.md,
    /// section "16. Error Handling").
    public let failureReason: String?

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
        updatedAt: Date,
        mediaClass: MediaClass,
        displayFilename: String,
        declaredContentType: String,
        declaredByteSize: Int64,
        mediaId: String? = nil,
        uploadUrl: String? = nil,
        uploadUrlExpiresAt: Date? = nil,
        mediaRevision: Int? = nil,
        bytesSent: Int64 = 0,
        serverUploadState: String? = nil,
        serverProcessingState: String? = nil,
        failureReason: String? = nil
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
        self.mediaClass = mediaClass
        self.displayFilename = displayFilename
        self.declaredContentType = declaredContentType
        self.declaredByteSize = declaredByteSize
        self.mediaId = mediaId
        self.uploadUrl = uploadUrl
        self.uploadUrlExpiresAt = uploadUrlExpiresAt
        self.mediaRevision = mediaRevision
        self.bytesSent = bytesSent
        self.serverUploadState = serverUploadState
        self.serverProcessingState = serverProcessingState
        self.failureReason = failureReason
    }

    /// A copy with `state`/`retryState`/`updatedAt` (and any other explicitly
    /// supplied field) replaced — the shape every `MediaUploadCoordinator`
    /// transition uses instead of re-listing all eighteen fields at each of
    /// its dozen call sites. Every parameter besides the three always
    /// supplied (`state`, `retryState`, `updatedAt`) is a plain single-level
    /// optional: passing one keeps the field unchanged. This deliberately
    /// cannot express "explicitly clear a field back to `nil`" — no
    /// transition in this codebase ever needs to (`mediaId`/`uploadUrl`/
    /// `mediaRevision` are only ever set once and then replaced by a later,
    /// real value on re-registration; the one field that does need to reset
    /// to `nil` on eventual success, `failureReason`, is cleared by
    /// `MediaUploadCoordinator` constructing a fresh value directly at that
    /// one call site instead of through this method).
    public func updating(
        state: MediaTransferState,
        retryState: RetryState,
        updatedAt: Date,
        serverConfirmedAt: Date? = nil,
        mediaId: String? = nil,
        uploadUrl: String? = nil,
        uploadUrlExpiresAt: Date? = nil,
        mediaRevision: Int? = nil,
        bytesSent: Int64? = nil,
        serverUploadState: String? = nil,
        serverProcessingState: String? = nil,
        failureReason: String? = nil
    ) -> MediaTransfer {
        MediaTransfer(
            id: id,
            gardenId: gardenId,
            localFileUrl: localFileUrl,
            checksum: checksum,
            byteCount: byteCount,
            state: state,
            retryState: retryState,
            serverConfirmedAt: serverConfirmedAt ?? self.serverConfirmedAt,
            createdAt: createdAt,
            updatedAt: updatedAt,
            mediaClass: mediaClass,
            displayFilename: displayFilename,
            declaredContentType: declaredContentType,
            declaredByteSize: declaredByteSize,
            mediaId: mediaId ?? self.mediaId,
            uploadUrl: uploadUrl ?? self.uploadUrl,
            uploadUrlExpiresAt: uploadUrlExpiresAt ?? self.uploadUrlExpiresAt,
            mediaRevision: mediaRevision ?? self.mediaRevision,
            bytesSent: bytesSent ?? self.bytesSent,
            serverUploadState: serverUploadState ?? self.serverUploadState,
            serverProcessingState: serverProcessingState ?? self.serverProcessingState,
            failureReason: failureReason ?? self.failureReason
        )
    }
}
