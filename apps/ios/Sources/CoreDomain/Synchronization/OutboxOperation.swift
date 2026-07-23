import Foundation

/// A pending local mutation waiting to be pushed to the server, and the
/// durable record of a mutation already pushed until its outcome is known.
///
/// Outbox payloads contain domain commands, not arbitrary row changes: an
/// `OutboxOperation` is a queued instruction ("apply this command"), never a
/// diff of a local read-model row.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation".
public struct OutboxOperation: Equatable, Sendable, Identifiable, Codable {
    /// The operation ID: a client-generated UUIDv7 (`CoreDomain.UUIDv7`),
    /// also the idempotency key the server uses to make retries safe.
    ///
    /// Source: architecture/offline-synchronization.md, section "9. Server
    /// Idempotency".
    public let id: String
    public let profileId: String
    public let gardenId: String
    public let commandType: String
    public let commandVersion: Int
    public let targetRecordIds: [String]
    /// The server revision this operation was built against. `nil` for
    /// commands that create a new record and so have no prior revision to
    /// check.
    public let expectedRevision: Int?
    /// The canonical domain command, opaque to `CorePersistence` and
    /// `CoreSynchronization` alike — neither layer inspects or reshapes it,
    /// only the feature that created it and the server that accepts it.
    public let payload: String
    public let dependencyOperationIds: [String]
    public let mediaPrerequisiteIds: [String]
    public let retryState: RetryState
    /// Local processing order.
    ///
    /// Deliberately not derived from `id`: a UUIDv7's random low bits do not
    /// guarantee insertion order for two operations created within the same
    /// millisecond, but local processing order must still be exact (section
    /// "16. Ordering"). `nil` until the store assigns it at insert time —
    /// see `CorePersistence.SyncOutboxStore.enqueue(_:)`.
    public let localSequence: Int64?
    public let createdAt: Date

    public init(
        id: String,
        profileId: String,
        gardenId: String,
        commandType: String,
        commandVersion: Int,
        targetRecordIds: [String],
        expectedRevision: Int?,
        payload: String,
        dependencyOperationIds: [String] = [],
        mediaPrerequisiteIds: [String] = [],
        retryState: RetryState = RetryState(),
        localSequence: Int64? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.profileId = profileId
        self.gardenId = gardenId
        self.commandType = commandType
        self.commandVersion = commandVersion
        self.targetRecordIds = targetRecordIds
        self.expectedRevision = expectedRevision
        self.payload = payload
        self.dependencyOperationIds = dependencyOperationIds
        self.mediaPrerequisiteIds = mediaPrerequisiteIds
        self.retryState = retryState
        self.localSequence = localSequence
        self.createdAt = createdAt
    }

    /// The same operation with its local processing order assigned. Called
    /// only by `SyncOutboxStore.enqueue(_:)`, once, at insert time.
    public func assigningLocalSequence(_ sequence: Int64) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: profileId,
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: commandVersion,
            targetRecordIds: targetRecordIds,
            expectedRevision: expectedRevision,
            payload: payload,
            dependencyOperationIds: dependencyOperationIds,
            mediaPrerequisiteIds: mediaPrerequisiteIds,
            retryState: retryState,
            localSequence: sequence,
            createdAt: createdAt
        )
    }

    /// The same operation with a new retry attempt recorded.
    public func recordingAttempt(errorCategory: SyncErrorCategory?, at date: Date) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: profileId,
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: commandVersion,
            targetRecordIds: targetRecordIds,
            expectedRevision: expectedRevision,
            payload: payload,
            dependencyOperationIds: dependencyOperationIds,
            mediaPrerequisiteIds: mediaPrerequisiteIds,
            retryState: retryState.recordingAttempt(errorCategory: errorCategory, at: date),
            localSequence: localSequence,
            createdAt: createdAt
        )
    }
}
