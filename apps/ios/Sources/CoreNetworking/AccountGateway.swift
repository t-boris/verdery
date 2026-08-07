import CoreDomain
import CoreObservability
import Foundation

/// The caller's own account: requesting its deletion, reading that request
/// back, and withdrawing it.
///
/// App Store Guideline 5.1.1(v) requires an account this application creates
/// to be deletable from inside it. `docs/development/ios-distribution.md`
/// section 12 has carried this as the first of its known gaps — the endpoints
/// existed, no iOS surface called them, and the app could not be submitted.
public protocol AccountGateway: Sendable {
    /// Moves the account to `deletion_requested`.
    ///
    /// Requires a sign-in newer than thirty minutes; an older session is
    /// refused with `deletion.recent_authentication_required`, which the
    /// caller answers by re-authenticating rather than by retrying.
    func requestAccountDeletion(idempotencyKey: String) async throws -> AccountDeletion
    func getAccountDeletion() async throws -> AccountDeletion?
    /// Withdraws the request, restoring the account and every membership and
    /// garden the request had put into deletion.
    func restoreAccount(idempotencyKey: String) async throws
}

struct AccountDeletionTransport: Decodable {
    let profileId: String
    let state: String
    let requestedAt: Date
    let recoveryDeadlineAt: Date
    let gardens: [Garden]

    struct Garden: Decodable {
        let gardenId: String
        let resolution: String
    }

    /// Unknown enum values decode to the conservative reading rather than
    /// throwing: a client that refuses to render a deletion it half-understands
    /// leaves somebody unable to see, or cancel, a request they made.
    var domainValue: AccountDeletion {
        AccountDeletion(
            profileId: profileId,
            state: AccountDeletionState(rawValue: state) ?? .purging,
            requestedAt: requestedAt,
            recoveryDeadlineAt: recoveryDeadlineAt,
            gardens: gardens.map {
                AccountDeletionGarden(
                    gardenId: $0.gardenId,
                    resolution: AccountDeletionGardenResolution(rawValue: $0.resolution)
                        ?? .membershipRevoked
                )
            }
        )
    }
}

public struct URLSessionAccountGateway: AccountGateway {
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

    public func requestAccountDeletion(idempotencyKey: String) async throws -> AccountDeletion {
        let response: AccountDeletionTransport = try await transport.send(
            method: "POST",
            operationPath: "account/deletion",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200, 201]
        )
        return response.domainValue
    }

    /// `nil` when there is no pending request — a `404` here is an answer,
    /// not a failure.
    public func getAccountDeletion() async throws -> AccountDeletion? {
        do {
            let response: AccountDeletionTransport = try await transport.get(
                operationPath: "account/deletion",
                acceptedStatusCodes: [200]
            )
            return response.domainValue
        } catch let error as APIGatewayError {
            if case let .service(_, statusCode, _) = error, statusCode == 404 { return nil }
            throw error
        }
    }

    public func restoreAccount(idempotencyKey: String) async throws {
        try await transport.sendNoContent(
            method: "DELETE",
            operationPath: "account/deletion",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey]
        )
    }
}
