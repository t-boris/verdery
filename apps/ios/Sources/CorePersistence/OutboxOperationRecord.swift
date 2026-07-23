import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `sync_outbox`.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation".
struct OutboxOperationRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_outbox"

    let localSequence: Int64
    let id: String
    let profileId: String
    let gardenId: String
    let commandType: String
    let commandVersion: Int
    let targetRecordIds: String
    let expectedRevision: Int?
    let payload: String
    let dependencyOperationIds: String
    let mediaPrerequisiteIds: String
    let retryCount: Int
    let lastErrorCategory: String?
    let lastAttemptedAt: Date?
    let resolvesConflictId: String?
    let createdAt: Date
}

extension OutboxOperationRecord {
    /// `operation.localSequence` must already be assigned — call this only
    /// after `OutboxOperation.assigningLocalSequence(_:)`, which every
    /// `SyncOutboxStore.enqueue(_:)` implementation calls before building
    /// this record.
    init(_ operation: OutboxOperation) {
        self.localSequence = operation.localSequence ?? 0
        self.id = operation.id
        self.profileId = operation.profileId
        self.gardenId = operation.gardenId
        self.commandType = operation.commandType
        self.commandVersion = operation.commandVersion
        self.targetRecordIds = JSONColumnCoding.encode(operation.targetRecordIds)
        self.expectedRevision = operation.expectedRevision
        self.payload = operation.payload
        self.dependencyOperationIds = JSONColumnCoding.encode(operation.dependencyOperationIds)
        self.mediaPrerequisiteIds = JSONColumnCoding.encode(operation.mediaPrerequisiteIds)
        self.retryCount = operation.retryState.attemptCount
        self.lastErrorCategory = operation.retryState.lastErrorCategory?.rawValue
        self.lastAttemptedAt = operation.retryState.lastAttemptedAt
        self.resolvesConflictId = operation.resolvesConflictId
        self.createdAt = operation.createdAt
    }

    var domainValue: OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: profileId,
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: commandVersion,
            targetRecordIds: JSONColumnCoding.decode(targetRecordIds),
            expectedRevision: expectedRevision,
            payload: payload,
            dependencyOperationIds: JSONColumnCoding.decode(dependencyOperationIds),
            mediaPrerequisiteIds: JSONColumnCoding.decode(mediaPrerequisiteIds),
            retryState: RetryState(
                attemptCount: retryCount,
                lastAttemptedAt: lastAttemptedAt,
                lastErrorCategory: lastErrorCategory.flatMap(SyncErrorCategory.init(rawValue:))
            ),
            localSequence: localSequence,
            resolvesConflictId: resolvesConflictId,
            createdAt: createdAt
        )
    }
}
