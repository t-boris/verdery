import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `media_transfer`.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer".
struct MediaTransferRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "media_transfer"

    let id: String
    let gardenId: String
    let localFileUrl: String
    let checksum: String?
    let byteCount: Int64?
    let state: String
    let retryCount: Int
    let lastErrorCategory: String?
    let lastAttemptedAt: Date?
    let serverConfirmedAt: Date?
    let createdAt: Date
    let updatedAt: Date

    // P6-IOS-01: the fields `MediaUploadCoordinator` needs to drive
    // registration, resumable upload, and recovery end to end — see
    // `CoreDomain.MediaTransfer`'s own doc comment for what each means.
    let mediaClass: String
    let displayFilename: String
    let declaredContentType: String
    let declaredByteSize: Int64
    let mediaId: String?
    let uploadUrl: String?
    let uploadUrlExpiresAt: Date?
    let mediaRevision: Int?
    let bytesSent: Int64
    let serverUploadState: String?
    let serverProcessingState: String?
    let failureReason: String?
}

extension MediaTransferRecord {
    init(_ transfer: MediaTransfer) {
        self.id = transfer.id
        self.gardenId = transfer.gardenId
        self.localFileUrl = transfer.localFileUrl
        self.checksum = transfer.checksum
        self.byteCount = transfer.byteCount
        self.state = transfer.state.rawValue
        self.retryCount = transfer.retryState.attemptCount
        self.lastErrorCategory = transfer.retryState.lastErrorCategory?.rawValue
        self.lastAttemptedAt = transfer.retryState.lastAttemptedAt
        self.serverConfirmedAt = transfer.serverConfirmedAt
        self.createdAt = transfer.createdAt
        self.updatedAt = transfer.updatedAt
        self.mediaClass = transfer.mediaClass.rawValue
        self.displayFilename = transfer.displayFilename
        self.declaredContentType = transfer.declaredContentType
        self.declaredByteSize = transfer.declaredByteSize
        self.mediaId = transfer.mediaId
        self.uploadUrl = transfer.uploadUrl
        self.uploadUrlExpiresAt = transfer.uploadUrlExpiresAt
        self.mediaRevision = transfer.mediaRevision
        self.bytesSent = transfer.bytesSent
        self.serverUploadState = transfer.serverUploadState
        self.serverProcessingState = transfer.serverProcessingState
        self.failureReason = transfer.failureReason
    }

    var domainValue: MediaTransfer? {
        guard
            let state = MediaTransferState(rawValue: state),
            let mediaClass = MediaClass(rawValue: mediaClass)
        else { return nil }

        return MediaTransfer(
            id: id,
            gardenId: gardenId,
            localFileUrl: localFileUrl,
            checksum: checksum,
            byteCount: byteCount,
            state: state,
            retryState: RetryState(
                attemptCount: retryCount,
                lastAttemptedAt: lastAttemptedAt,
                lastErrorCategory: lastErrorCategory.flatMap(SyncErrorCategory.init(rawValue:))
            ),
            serverConfirmedAt: serverConfirmedAt,
            createdAt: createdAt,
            updatedAt: updatedAt,
            mediaClass: mediaClass,
            displayFilename: displayFilename,
            declaredContentType: declaredContentType,
            declaredByteSize: declaredByteSize,
            mediaId: mediaId,
            uploadUrl: uploadUrl,
            uploadUrlExpiresAt: uploadUrlExpiresAt,
            mediaRevision: mediaRevision,
            bytesSent: bytesSent,
            serverUploadState: serverUploadState,
            serverProcessingState: serverProcessingState,
            failureReason: failureReason
        )
    }
}
