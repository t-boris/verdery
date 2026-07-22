import Foundation
import Synchronization

/// URLProtocol that answers requests from a per-session script.
///
/// The gateway is exercised through a real URLSession so that request
/// construction, status handling, and decoding are all covered; only the
/// network itself is replaced.
///
/// Source: architecture/testing-strategy.md, section "8. Native Tests" —
/// "URLSession gateway mapping".
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Answer: Sendable {
        let statusCode: Int
        let body: Data
        /// Set to simulate a connectivity failure instead of a response.
        let failure: URLError?

        init(statusCode: Int, body: Data, failure: URLError? = nil) {
            self.statusCode = statusCode
            self.body = body
            self.failure = failure
        }

        static func json(_ statusCode: Int, _ json: String) -> Answer {
            Answer(statusCode: statusCode, body: Data(json.utf8))
        }

        static func transportFailure(_ code: URLError.Code) -> Answer {
            Answer(statusCode: 0, body: Data(), failure: URLError(code))
        }
    }

    /// Answers and observed requests keyed by session identifier, so parallel
    /// tests cannot see each other's traffic.
    private static let state = Mutex<[String: (answer: Answer, requests: [URLRequest])]>([:])

    static func register(_ answer: Answer, forSession identifier: String) {
        state.withLock { $0[identifier] = (answer, []) }
    }

    static func requests(forSession identifier: String) -> [URLRequest] {
        state.withLock { $0[identifier]?.requests ?? [] }
    }

    static func unregister(_ identifier: String) {
        state.withLock { $0[identifier] = nil }
    }

    /// Session identity is carried in a header because URLProtocol receives the
    /// request, not the session that issued it.
    static let sessionHeader = "X-Test-Session"

    static func makeSession(identifier: String) -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.httpAdditionalHeaders = [sessionHeader: identifier]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard
            let identifier = request.value(forHTTPHeaderField: Self.sessionHeader),
            let answer = Self.state.withLock({ state -> Answer? in
                guard var entry = state[identifier] else { return nil }
                entry.requests.append(request)
                state[identifier] = entry
                return entry.answer
            })
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }

        if let failure = answer.failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }

        let response = HTTPURLResponse(
            url: request.url ?? URL(fileURLWithPath: "/"),
            statusCode: answer.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )

        if let response {
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        }

        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
