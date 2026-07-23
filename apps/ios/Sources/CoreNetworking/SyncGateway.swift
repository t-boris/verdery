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

/// The application's view of the synchronization endpoints: client
/// installation registration, pushing a bounded batch of outbox operations,
/// and re-learning already-decided outcomes without resending payloads.
///
/// Features never depend on this directly — only `CoreSynchronization`'s
/// `RemoteSyncEngine` does, the same "handwritten gateway wraps generated-
/// shape operations, features/engines depend on the protocol, never on
/// `URLSession`" pattern `GardenGateway`/`TaskGateway` already establish.
///
/// `GET /sync/changes` (pull) has no method here yet — Stage 5b's concern;
/// see `CoreSynchronization.SyncEngine.pullChanges()`'s own doc comment.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// architecture/offline-synchronization.md, sections "8. Push Protocol",
/// "9. Server Idempotency", "12. Initial Synchronization"; packages/api-contracts/openapi.yaml,
/// tag `Synchronization`.
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
}
