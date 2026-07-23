import CoreDomain
import CoreObservability
import Foundation

/// One record this operation created or changed, at its new revision —
/// `packages/api-contracts/openapi.yaml`, `SyncRecordReference`.
public struct SyncRecordReference: Equatable, Sendable {
    public let recordId: String
    public let recordType: String
    public let revision: Int

    public init(recordId: String, recordType: String, revision: Int) {
        self.recordId = recordId
        self.recordType = recordType
        self.revision = revision
    }
}

/// The application's view of one operation's outcome from `POST /sync/push`
/// or `POST /sync/acknowledge` — `packages/api-contracts/openapi.yaml`,
/// `SyncPushOperationResult`/`SyncOperationLookupResult`. Both endpoints
/// return the same six push outcomes in the same per-item shape;
/// `acknowledge` adds a seventh, `unknown`, for an operation id the server
/// has no stored result for.
///
/// A plain Swift enum with associated values, not the wire's `oneOf` —
/// `URLSessionSyncGateway` decodes the flexible
/// `SyncPushOperationResultTransport` (every branch's fields folded into one
/// optional set) and maps it here, the gateway's own job of translating a
/// transport shape into something the application depends on instead.
public enum SyncPushOperationOutcome: Equatable, Sendable {
    case accepted(operationId: String, recordRevisions: [SyncRecordReference])
    case duplicate(operationId: String, recordRevisions: [SyncRecordReference])
    case conflict(operationId: String, conflictCode: String, currentRecordType: String, currentRecordJSON: String)
    case rejected(operationId: String, errorCode: String, errorMessage: String)
    case blockedByDependency(operationId: String, blockingOperationIds: [String])
    case retryLater(operationId: String, retryAfterSeconds: Int?, reason: String?)
    /// `acknowledge`-only: no durable outcome is stored for this operation id.
    case unknown(operationId: String)

    public var operationId: String {
        switch self {
        case let .accepted(id, _): id
        case let .duplicate(id, _): id
        case let .conflict(id, _, _, _): id
        case let .rejected(id, _, _): id
        case let .blockedByDependency(id, _): id
        case let .retryLater(id, _, _): id
        case let .unknown(id): id
        }
    }
}

/// One change item from `GET /sync/changes` — `packages/api-contracts/
/// openapi.yaml`, `SyncChange`.
public struct SyncChange: Equatable, Sendable {
    public let sequence: Int64
    /// `nil` only for a record with no owning garden; every change the
    /// server produces today always has one (`SyncChange`'s own contract doc
    /// comment) — carried through as-is rather than force-unwrapped, since a
    /// client should not crash on a server-side invariant it cannot itself
    /// enforce.
    public let gardenId: String?
    public let recordId: String
    public let recordType: String
    public let operation: SyncChangeOperation
    public let recordRevision: Int
    public let committedAt: Date
    /// Present only when `operation == .upsert` — a tombstone carries no
    /// further payload (`SyncChange`'s own contract doc comment: "no further
    /// payload is needed to apply it").
    public let snapshot: SyncChangeSnapshot?

    public init(
        sequence: Int64,
        gardenId: String?,
        recordId: String,
        recordType: String,
        operation: SyncChangeOperation,
        recordRevision: Int,
        committedAt: Date,
        snapshot: SyncChangeSnapshot?
    ) {
        self.sequence = sequence
        self.gardenId = gardenId
        self.recordId = recordId
        self.recordType = recordType
        self.operation = operation
        self.recordRevision = recordRevision
        self.committedAt = committedAt
        self.snapshot = snapshot
    }
}

public enum SyncChangeOperation: String, Equatable, Sendable {
    case upsert
    case delete
}

/// One pulled record's current, decoded snapshot — `packages/api-contracts/
/// openapi.yaml`, `SyncRecordSnapshot`'s `oneOf`, decoded here rather than
/// kept opaque (unlike push's `SyncPushOperationOutcome.conflict`'s
/// `currentRecordJSON`): pull's whole purpose is to project a genuinely new
/// or differently-changed record into this device's own local read model, so
/// `CoreSynchronization.SyncRecordApplier` conformers need a real
/// `CoreDomain` value to hand to `save`/`replaceAll`-style methods, not text
/// they would each have to re-decode themselves (which would also mean
/// re-implementing `GardenTransport`/`GardenObjectTransport`/`PlantTransport`/
/// `GardenTaskTransport`'s own wire decoding a second time, outside the
/// gateway layer the architecture reserves it to).
///
/// Every case's payload type already lives in `CoreDomain` — `Garden`,
/// `GardenMapObject`, `Plant`, `GardenTask` — the same types
/// `GardenGateway`/`MapGateway`/`PlantGateway`/`TaskGateway` already decode
/// from their own always-fresh-from-server reads, reused here rather than
/// duplicated.
public enum SyncChangeSnapshot: Equatable, Sendable {
    case garden(Garden)
    case gardenObject(GardenMapObject)
    case plant(Plant)
    case task(GardenTask)
    /// A record type this client pulls the change's identity/revision/
    /// sequence for but keeps no typed domain snapshot of — either because
    /// no local applier ever projects it at all (`calibration`, matching
    /// `RemoteSyncEngine.applyConfirmedRecords`'s identical push-side "not an
    /// error" skip for the same record type) or because the owning
    /// feature's local store is pending-only, with no full confirmed-record
    /// cache to write a pulled snapshot into (`observation` — see
    /// `FeatureObservations.LocalObservationStore`'s own doc comment).
    case unprojected(recordType: String)
}

/// One bounded, ordered page from `GET /sync/changes` — `packages/api-
/// contracts/openapi.yaml`, `SyncChangesResult`. `nextCursor` is always
/// present, including on an empty or final page (that schema's own doc
/// comment) — unlike `GardenPage`/every other list result in this app, whose
/// `nextCursor` is `nil` once caught up.
public struct SyncChangesPage: Equatable, Sendable {
    public let items: [SyncChange]
    public let nextCursor: String

    public init(items: [SyncChange], nextCursor: String) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// The application's view of the synchronization endpoints: client
/// installation registration, pushing a bounded batch of outbox operations,
/// pulling a page of the change log, and re-learning already-decided
/// outcomes without resending payloads.
///
/// Features never depend on this directly — only `CoreSynchronization`'s
/// `RemoteSyncEngine` does, the same "handwritten gateway wraps generated-
/// shape operations, features/engines depend on the protocol, never on
/// `URLSession`" pattern `GardenGateway`/`TaskGateway` already establish.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// architecture/offline-synchronization.md, sections "8. Push Protocol",
/// "9. Server Idempotency", "10. Pull Protocol", "12. Initial Synchronization";
/// packages/api-contracts/openapi.yaml, tag `Synchronization`.
public protocol SyncGateway: Sendable {
    /// Registers this client installation, or idempotently refreshes an
    /// already-registered one under the same id — `PUT`, not `POST`, because
    /// `clientInstallationId` is client-minted, never server-assigned.
    /// Platform is always `ios` from this client; not a parameter, since it
    /// never varies.
    func registerClient(
        clientInstallationId: String,
        appVersion: String,
        protocolVersion: Int
    ) async throws

    /// Pushes a bounded, ordered batch of outbox operations and returns one
    /// outcome per operation, in request order (`operations.count ==` the
    /// returned array's count, per the contract's own "Same length and
    /// order as the request's operations").
    ///
    /// Unlike every other mutation this app sends, this call carries no
    /// `Idempotency-Key` header — each operation's own `operationId` already
    /// is that operation's idempotency key (architecture/offline-
    /// synchronization.md, section "9. Server Idempotency").
    func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome]

    /// Re-learns the durable outcome of operation ids this client believes
    /// it already pushed, without resending their payloads — a cheaper
    /// alternative to a full push retry after, for example, a lost response.
    /// Built alongside `registerClient`/`push` per this stage's own scope,
    /// even though nothing calls it yet: `RemoteSyncEngine.pushPending()`
    /// only ever calls `push` this stage — see that type's own doc comment.
    func acknowledge(
        clientInstallationId: String,
        operationIds: [String]
    ) async throws -> [SyncPushOperationOutcome]

    /// Pulls one bounded, ordered page of the profile-wide change log —
    /// `GET /sync/changes`. Profile-scoped, not per-garden, and carries no
    /// `clientInstallationId` at all — both confirmed directly against
    /// `packages/api-contracts/openapi.yaml`'s own parameter list for this
    /// operation (`after`, `limit`, `protocolVersion`; nothing else) and
    /// `GetSyncChanges.execute(profileId:request:)`'s own signature
    /// server-side, not assumed from architecture/offline-synchronization.md,
    /// section "10. Pull Protocol"'s prose alone — see `CoreDomain.SyncCursor`'s
    /// own doc comment for the fuller account of this correction.
    ///
    /// - Parameter after: The durable cursor to resume from; `nil` for a
    ///   first-ever pull or an explicit full resync (`CorePersistence
    ///   .SyncCursorStore.reset()`).
    /// - Parameter limit: Bounded `1...100` by the contract
    ///   (`components.parameters.Limit`).
    /// - Throws: `APIGatewayError.service` with `error.code`
    ///   `sync.changes.cursor_expired` or `sync.protocol_version.unsupported`
    ///   (both `409`) when a full resynchronization is required — architecture/
    ///   offline-synchronization.md, section "13. Full Resynchronization".
    func getChanges(
        protocolVersion: Int,
        after: String?,
        limit: Int
    ) async throws -> SyncChangesPage
}

/// URLSession-backed implementation of the synchronization operations.
public struct URLSessionSyncGateway: SyncGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func registerClient(
        clientInstallationId: String,
        appVersion: String,
        protocolVersion: Int
    ) async throws {
        let _: SyncClientInstallationTransport = try await transport.send(
            method: "PUT",
            operationPath: "sync/clients/\(clientInstallationId)",
            body: SyncClientRegistrationRequestTransport(
                platform: "ios",
                appVersion: appVersion,
                protocolVersion: protocolVersion
            ),
            acceptedStatusCodes: [200, 201]
        )
    }

    public func push(
        clientInstallationId: String,
        protocolVersion: Int,
        operationPayloadVersion: Int,
        operations: [OutboxOperation]
    ) async throws -> [SyncPushOperationOutcome] {
        let body = SyncPushRequestTransport(
            clientInstallationId: clientInstallationId,
            protocolVersion: protocolVersion,
            operationPayloadVersion: operationPayloadVersion,
            operations: try operations.map(SyncOperationTransport.init)
        )
        let result: SyncPushResultTransport = try await transport.send(
            method: "POST",
            operationPath: "sync/push",
            body: body,
            acceptedStatusCodes: [200]
        )
        return try result.results.map { try $0.makeDomainOutcome() }
    }

    public func acknowledge(
        clientInstallationId: String,
        operationIds: [String]
    ) async throws -> [SyncPushOperationOutcome] {
        let result: SyncAcknowledgeResultTransport = try await transport.send(
            method: "POST",
            operationPath: "sync/acknowledge",
            body: SyncAcknowledgeRequestTransport(
                clientInstallationId: clientInstallationId,
                operationIds: operationIds
            ),
            acceptedStatusCodes: [200]
        )
        return try result.results.map { try $0.makeDomainOutcome() }
    }

    public func getChanges(
        protocolVersion: Int,
        after: String?,
        limit: Int
    ) async throws -> SyncChangesPage {
        var path = "sync/changes?limit=\(limit)&protocolVersion=\(protocolVersion)"
        if let after, let encoded = after.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&after=\(encoded)"
        }

        let result: SyncChangesResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return SyncChangesPage(items: try result.items.map(Self.domainChange), nextCursor: result.nextCursor)
    }

    private static func domainChange(_ transport: SyncChangeTransport) throws -> SyncChange {
        guard let operation = SyncChangeOperation(rawValue: transport.operation) else {
            // A newer protocol's operation value this client build does not
            // recognize — the same "additive fields are safely ignorable, a
            // wholly new discriminator value is not" posture
            // `SyncPushOperationResultTransport.makeDomainOutcome()`'s own
            // `default` branch already takes for push's `outcome` field.
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }

        let snapshot: SyncChangeSnapshot?
        if operation == .upsert {
            guard let record = transport.record else { throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "") }
            snapshot = try domainSnapshot(record, recordType: transport.recordType)
        } else {
            snapshot = nil
        }

        return SyncChange(
            sequence: transport.sequence,
            gardenId: transport.gardenId,
            recordId: transport.recordId,
            recordType: transport.recordType,
            operation: operation,
            recordRevision: transport.recordRevision,
            committedAt: transport.committedAt,
            snapshot: snapshot
        )
    }

    /// Decodes `SyncChange.record`'s `{recordType, data}` envelope a second
    /// time, into whichever typed `*Transport` struct `recordType` names —
    /// the same structs `GardenGateway`/`MapGateway`/`PlantGateway`/
    /// `TaskGateway` already decode their own always-fresh-from-server reads
    /// into, reused here rather than duplicated, since `SyncRecordSnapshot`'s
    /// `data` schema for each record type is the exact same `Garden`/
    /// `GardenObject`/`Plant`/`Task` schema those endpoints already return.
    ///
    /// `record` arrives as `JSONPassthroughValue` — the same "flexible whole-
    /// envelope decode, then a second typed pass once the discriminator is
    /// known" shape `SyncPushOperationResultTransport.currentRecord` already
    /// uses for push's conflict payload — because `HTTPTransport.execute`'s
    /// single generic decode cannot itself branch on `recordType` the way a
    /// hand-written `init(from:)` could; re-serializing the already-parsed
    /// `data` field and decoding it again is simpler and no less correct than
    /// teaching `SyncChangeTransport` a custom keyed-container decoder for a
    /// five-way discriminated union it would otherwise need to duplicate
    /// `SyncRecordSnapshot`'s own discriminator mapping to get right.
    private static func domainSnapshot(_ record: JSONPassthroughValue, recordType: String) throws -> SyncChangeSnapshot {
        guard recordType == "garden" || recordType == "gardenObject" || recordType == "plant" || recordType == "task" else {
            // `calibration`/`observation`, or an unrecognized future record
            // type — no typed local projection exists to decode into; see
            // `SyncChangeSnapshot.unprojected`'s own doc comment.
            return .unprojected(recordType: recordType)
        }
        guard let dataValue = record.value(forKey: "data") else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        let data = Data(try dataValue.jsonText().utf8)

        switch recordType {
        case "garden":
            let garden = try HTTPTransport.decoder.decode(GardenTransport.self, from: data)
            guard let domainValue = garden.domainValue else {
                throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
            }
            return .garden(domainValue)
        case "gardenObject":
            let object = try HTTPTransport.decoder.decode(GardenObjectTransport.self, from: data)
            return .gardenObject(object.domainValue)
        case "plant":
            let plant = try HTTPTransport.decoder.decode(PlantTransport.self, from: data)
            return .plant(plant.domainValue)
        default:
            let task = try HTTPTransport.decoder.decode(GardenTaskTransport.self, from: data)
            return .task(task.domainValue)
        }
    }
}
