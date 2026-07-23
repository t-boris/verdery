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
    }

    var domainValue: MediaTransfer? {
        guard let state = MediaTransferState(rawValue: state) else { return nil }

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
            updatedAt: updatedAt
        )
    }
}
