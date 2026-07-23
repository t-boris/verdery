import CoreDomain
import Foundation

/// Wire shapes of the synchronization operations.
///
/// These types stay internal: the architecture requires generated or
/// transport models to remain behind the application gateway. The public
/// application-level types they map to/from — `SyncRecordReference`,
/// `SyncPushOperationOutcome` — live in `SyncGateway.swift`, mirroring
/// `GardenTransport.swift`/`GardenGateway.swift`'s identical split.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency
/// Rules"; packages/api-contracts/openapi.yaml, tag `Synchronization`.
struct SyncClientRegistrationRequestTransport: Encodable {
    let platform: String
    let appVersion: String
    let protocolVersion: Int
}

/// Only decoded to satisfy `HTTPTransport.send`'s generic response
/// requirement — `SyncGateway.registerClient` reports success or failure,
/// never the registered installation's own fields, back to its caller.
struct SyncClientInstallationTransport: Decodable {
    let id: String
    let platform: String
    let appVersion: String
    let protocolVersion: Int
}

struct SyncMediaPrerequisiteTransport: Encodable {
    let mediaId: String
    let allowPendingUpload: Bool
}

struct SyncOperationTransport: Encodable {
    let operationId: String
    let commandVersion: Int
    let localSequence: Int64
    let dependsOnOperationIds: [String]
    let mediaPrerequisites: [SyncMediaPrerequisiteTransport]
    let payload: JSONPassthroughValue

    /// - Parameter operation: `operation.payload` is already the exact
    ///   `SyncOperationPayload` wire shape (`{recordType, gardenId, command}`)
    ///   — see `FeatureGardens.GardenSyncCommandPayload`'s own doc comment —
    ///   so this only parses it back into a `JSONPassthroughValue` to embed,
    ///   never re-derives it. `mediaPrerequisites` all default to
    ///   `allowPendingUpload: false`: `OutboxOperation.mediaPrerequisiteIds`
    ///   is a plain `[String]` with no richer per-id flag yet — nothing in
    ///   this codebase populates it today (no upload flow exists — see
    ///   `FeatureObservations.ObservationsUseCases.swift`'s own doc comment),
    ///   so this is a provisional, honest default, not a regression.
    init(_ operation: OutboxOperation) throws {
        self.operationId = operation.id
        self.commandVersion = operation.commandVersion
        // `nil` only before `SyncOutboxStore.enqueue(_:)` assigns one; every
        // operation `pushPending()` reads back out already has one — see
        // `OutboxOperation.localSequence`'s own doc comment. `?? 0` mirrors
        // `InMemorySyncOutboxStore`'s own identical defensive fallback.
        self.localSequence = operation.localSequence ?? 0
        self.dependsOnOperationIds = operation.dependencyOperationIds
        self.mediaPrerequisites = operation.mediaPrerequisiteIds.map {
            SyncMediaPrerequisiteTransport(mediaId: $0, allowPendingUpload: false)
        }
        self.payload = try JSONPassthroughValue(jsonText: operation.payload)
    }
}

struct SyncPushRequestTransport: Encodable {
    let clientInstallationId: String
    let protocolVersion: Int
    let operationPayloadVersion: Int
    let operations: [SyncOperationTransport]
}

struct SyncOperationErrorTransport: Decodable {
    let code: String
    let message: String
}

/// One flexible struct for `SyncPushOperationResult`'s/
/// `SyncOperationLookupResult`'s whole `oneOf` union, discriminated on
/// `outcome` — every field besides `outcome`/`operationId` is only present
/// on the wire for some branches, so every one of them is `Optional` here;
/// `makeDomainOutcome()` enforces which are actually required for a given
/// `outcome` at the point it builds the typed ``SyncPushOperationOutcome``.
struct SyncPushOperationResultTransport: Decodable {
    let outcome: String
    let operationId: String
    let recordRevisions: [SyncRecordReferenceTransport]?
    let conflictCode: String?
    let currentRecord: JSONPassthroughValue?
    let error: SyncOperationErrorTransport?
    let blockingOperationIds: [String]?
    let retryAfterSeconds: Int?
    let reason: String?

    func makeDomainOutcome() throws -> SyncPushOperationOutcome {
        switch outcome {
        case "accepted":
            return .accepted(operationId: operationId, recordRevisions: try nonEmptyRecordRevisions())
        case "duplicate":
            return .duplicate(operationId: operationId, recordRevisions: try nonEmptyRecordRevisions())
        case "conflict":
            guard
                let conflictCode,
                let currentRecord,
                let currentRecordType = currentRecord.stringValue(forKey: "recordType")
            else {
                throw undecodable()
            }
            return .conflict(
                operationId: operationId,
                conflictCode: conflictCode,
                currentRecordType: currentRecordType,
                currentRecordJSON: try currentRecord.jsonText()
            )
        case "rejected":
            guard let error else { throw undecodable() }
            return .rejected(operationId: operationId, errorCode: error.code, errorMessage: error.message)
        case "blockedByDependency":
            return .blockedByDependency(operationId: operationId, blockingOperationIds: blockingOperationIds ?? [])
        case "retryLater":
            return .retryLater(operationId: operationId, retryAfterSeconds: retryAfterSeconds, reason: reason)
        case "unknown":
            return .unknown(operationId: operationId)
        default:
            // A newer protocol's outcome value this client build does not
            // recognize — architecture/offline-synchronization.md, section
            // "21. Protocol Versioning" only promises additive *fields* are
            // safely ignorable, not a wholly new discriminator value, so
            // this surfaces as a contract violation rather than silently
            // dropping the operation's real outcome.
            throw undecodable()
        }
    }

    private func nonEmptyRecordRevisions() throws -> [SyncRecordReference] {
        guard let recordRevisions, !recordRevisions.isEmpty else { throw undecodable() }
        return recordRevisions.map(\.domainValue)
    }

    private func undecodable() -> APIGatewayError {
        .undecodableResponse(statusCode: 200, correlationId: "")
    }
}

struct SyncRecordReferenceTransport: Decodable {
    let recordId: String
    let recordType: String
    let revision: Int

    var domainValue: SyncRecordReference {
        SyncRecordReference(recordId: recordId, recordType: recordType, revision: revision)
    }
}

struct SyncPushResultTransport: Decodable {
    let results: [SyncPushOperationResultTransport]
}

struct SyncAcknowledgeRequestTransport: Encodable {
    let clientInstallationId: String
    let operationIds: [String]
}

struct SyncAcknowledgeResultTransport: Decodable {
    let results: [SyncPushOperationResultTransport]
}

/// `packages/api-contracts/openapi.yaml`, `SyncChange`. `record` stays
/// `JSONPassthroughValue` here — the whole `{recordType, data}`
/// `SyncRecordSnapshot` envelope — rather than one of the five typed
/// snapshot structs: which one applies depends on `recordType`, a sibling
/// field this struct's own `Decodable` synthesis has no way to branch on,
/// so `SyncGateway.domainSnapshot(_:recordType:)` does that second, typed
/// decode pass once `recordType` is already known.
struct SyncChangeTransport: Decodable {
    let sequence: Int64
    let gardenId: String?
    let recordId: String
    let recordType: String
    let operation: String
    let recordRevision: Int
    let committedAt: Date
    let record: JSONPassthroughValue?
}

struct SyncChangesResultTransport: Decodable {
    let items: [SyncChangeTransport]
    let nextCursor: String
}
