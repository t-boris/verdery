import CoreObservability
import Foundation

/// The single place where URLSession is used.
///
/// Keeping request construction, status handling, and error-envelope decoding in
/// one type means every operation gets the same timeouts, the same correlation
/// header, and the same redaction rules by construction rather than by review.
///
/// Source: architecture/ios-application-design.md, section "9. Networking".
struct HTTPTransport: Sendable {
    private let configuration: APIConfiguration
    private let session: URLSession
    private let correlationIdentifiers: any CorrelationIdentifierProvider
    private let log: any DiagnosticLog

    init(
        configuration: APIConfiguration,
        session: URLSession,
        correlationIdentifiers: any CorrelationIdentifierProvider,
        log: any DiagnosticLog
    ) {
        self.configuration = configuration
        self.session = session
        self.correlationIdentifiers = correlationIdentifiers
        self.log = log
    }

    /// Performs a safe GET and decodes the declared success body.
    ///
    /// - Parameter acceptedStatusCodes: Status codes the operation declares as
    ///   carrying the success body. Anything else is decoded as the error
    ///   envelope.
    func get<Response: Decodable>(
        operationPath: String,
        acceptedStatusCodes: Set<Int>
    ) async throws -> Response {
        let correlationId = correlationIdentifiers.next()
        let request = makeRequest(operationPath: operationPath, correlationId: correlationId)

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            // Only the failure class is logged. A URL can carry identifiers and
            // the underlying error can carry host detail, neither of which
            // belongs in a diagnostic record.
            log.record(.warning, "Health request failed in transport.", correlationId: correlationId)
            throw APIGatewayError.transport(code: error.code, correlationId: correlationId.value)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIGatewayError.undecodableResponse(
                statusCode: 0,
                correlationId: correlationId.value
            )
        }

        guard acceptedStatusCodes.contains(http.statusCode) else {
            throw errorForRejectedStatus(
                statusCode: http.statusCode,
                data: data,
                correlationId: correlationId
            )
        }

        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            log.record(
                .error,
                "Health response did not match the contract.",
                correlationId: correlationId
            )
            throw APIGatewayError.undecodableResponse(
                statusCode: http.statusCode,
                correlationId: correlationId.value
            )
        }
    }

    private func makeRequest(operationPath: String, correlationId: CorrelationIdentifier) -> URLRequest {
        var request = URLRequest(
            url: configuration.url(forOperationPath: operationPath),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: configuration.requestTimeout
        )

        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            correlationId.value,
            forHTTPHeaderField: APIConfiguration.correlationIdHeader
        )

        return request
    }

    /// Maps a rejected status onto the contract's error envelope.
    ///
    /// A body that cannot be decoded as the envelope is reported as a contract
    /// violation rather than being invented into a plausible service error,
    /// because guessing here would hide a genuine deployment mismatch.
    private func errorForRejectedStatus(
        statusCode: Int,
        data: Data,
        correlationId: CorrelationIdentifier
    ) -> APIGatewayError {
        guard let envelope = try? Self.decoder.decode(APIErrorEnvelope.self, from: data) else {
            return .unexpectedStatus(statusCode, correlationId: correlationId.value)
        }

        return .service(envelope.error, statusCode: statusCode)
    }

    private static let decoder = JSONDecoder()
}
