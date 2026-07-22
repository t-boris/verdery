import CoreDomain
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
    private let authTokenProvider: (any AuthTokenProvider)?
    private let log: any DiagnosticLog

    init(
        configuration: APIConfiguration,
        session: URLSession,
        correlationIdentifiers: any CorrelationIdentifierProvider,
        authTokenProvider: (any AuthTokenProvider)? = nil,
        log: any DiagnosticLog
    ) {
        self.configuration = configuration
        self.session = session
        self.correlationIdentifiers = correlationIdentifiers
        self.authTokenProvider = authTokenProvider
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
        try await execute(
            method: "GET",
            operationPath: operationPath,
            body: EmptyBody?.none,
            headers: [:],
            acceptedStatusCodes: acceptedStatusCodes
        )
    }

    /// Sends a mutation with a JSON body and decodes the declared success body.
    func send<Body: Encodable, Response: Decodable>(
        method: String,
        operationPath: String,
        body: Body,
        headers: [String: String] = [:],
        acceptedStatusCodes: Set<Int>
    ) async throws -> Response {
        try await execute(
            method: method,
            operationPath: operationPath,
            body: body,
            headers: headers,
            acceptedStatusCodes: acceptedStatusCodes
        )
    }

    /// Sends a bodyless mutation and decodes the declared success body.
    func send<Response: Decodable>(
        method: String,
        operationPath: String,
        headers: [String: String] = [:],
        acceptedStatusCodes: Set<Int>
    ) async throws -> Response {
        try await execute(
            method: method,
            operationPath: operationPath,
            body: EmptyBody?.none,
            headers: headers,
            acceptedStatusCodes: acceptedStatusCodes
        )
    }

    /// Sends a mutation with a JSON body and no response body (`204`).
    func sendNoContent<Body: Encodable>(
        method: String,
        operationPath: String,
        body: Body,
        headers: [String: String] = [:]
    ) async throws {
        let _: EmptyBody = try await execute(
            method: method,
            operationPath: operationPath,
            body: body,
            headers: headers,
            acceptedStatusCodes: [204]
        )
    }

    /// Sends a bodyless mutation and no response body (`204`).
    func sendNoContent(
        method: String,
        operationPath: String,
        headers: [String: String] = [:]
    ) async throws {
        let _: EmptyBody = try await execute(
            method: method,
            operationPath: operationPath,
            body: EmptyBody?.none,
            headers: headers,
            acceptedStatusCodes: [204]
        )
    }

    private func execute<Body: Encodable, Response: Decodable>(
        method: String,
        operationPath: String,
        body: Body?,
        headers: [String: String],
        acceptedStatusCodes: Set<Int>
    ) async throws -> Response {
        let correlationId = correlationIdentifiers.next()
        let request = try await makeRequest(
            method: method,
            operationPath: operationPath,
            body: body,
            headers: headers,
            correlationId: correlationId
        )

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            // Only the failure class is logged. A URL can carry identifiers and
            // the underlying error can carry host detail, neither of which
            // belongs in a diagnostic record.
            log.record(.warning, "Request failed in transport.", correlationId: correlationId)
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

        if Response.self == EmptyBody.self {
            // Response bodies are typed generically across every operation in
            // this transport; only this file constructs an EmptyBody, so the
            // dynamic-type check above makes the cast provably safe.
            return EmptyBody() as! Response
        }

        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            log.record(
                .error,
                "Response did not match the contract.",
                correlationId: correlationId
            )
            throw APIGatewayError.undecodableResponse(
                statusCode: http.statusCode,
                correlationId: correlationId.value
            )
        }
    }

    private func makeRequest<Body: Encodable>(
        method: String,
        operationPath: String,
        body: Body?,
        headers: [String: String],
        correlationId: CorrelationIdentifier
    ) async throws -> URLRequest {
        var request = URLRequest(
            url: configuration.url(forOperationPath: operationPath),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: configuration.requestTimeout
        )

        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            correlationId.value,
            forHTTPHeaderField: APIConfiguration.correlationIdHeader
        )

        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        if let provider = authTokenProvider, let idToken = try await provider.currentIdToken() {
            request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(body)
        }

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

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        // The plain `.iso8601` strategy rejects fractional seconds, which
        // every timestamp this API emits carries (`Date.toISOString()` on the
        // server always includes milliseconds). Confirmed directly: decoding
        // a real `createdAt` value failed until this formatter was added.
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)

            if let date = ISO8601DateFormatter.withFractionalSeconds.date(from: text) {
                return date
            }
            if let date = ISO8601DateFormatter.withoutFractionalSeconds.date(from: text) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "\(text) is not an RFC 3339 timestamp."
            )
        }
        return decoder
    }()

    // No custom date encoding strategy: every request body this transport
    // currently sends is date-free (garden names, an ID token). Add one here,
    // not ad hoc per call site, the day a request body needs one.
    private static let encoder = JSONEncoder()
}

/// Marker body/response for a request or response with no JSON content.
struct EmptyBody: Codable {}
