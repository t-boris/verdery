import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the transport-level header wiring `HealthGatewayTests` has no
/// reason to: `HealthGateway` never authenticates, so `GardenGateway` is the
/// only gateway that exercises `authTokenProvider` and `appCheckTokenProvider`
/// at all. Neither header had a test before this file.
@Suite("Garden gateway")
struct GardenGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(
        identifier: String,
        answer: StubURLProtocol.Answer,
        authToken: String?,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil
    ) -> URLSessionGardenGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionGardenGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: authToken),
            appCheckTokenProvider: appCheckTokenProvider,
            log: NoOperationDiagnosticLog()
        )
    }

    private static let emptyPage = #"{"items":[],"nextCursor":null}"#

    @Test("Attaches the Authorization header when the auth token provider returns a token")
    func attachesAuthorizationHeader() async throws {
        let identifier = "auth-present"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: "id-token-123"
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-token-123")
    }

    @Test("Omits the Authorization header when the auth token provider returns nil")
    func omitsAuthorizationHeaderWhenSignedOut() async throws {
        let identifier = "auth-absent"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: nil
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test("Attaches the App Check header when the App Check token provider returns a token")
    func attachesAppCheckHeader() async throws {
        let identifier = "appcheck-present"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: nil,
            appCheckTokenProvider: FakeAppCheckTokenProvider(token: "app-check-token-456")
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(
            request.value(forHTTPHeaderField: APIConfiguration.appCheckHeader) == "app-check-token-456"
        )
    }

    @Test("Omits the App Check header when no App Check token provider is configured")
    func omitsAppCheckHeaderWhenProviderIsAbsent() async throws {
        let identifier = "appcheck-absent-provider"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: nil,
            appCheckTokenProvider: nil
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.value(forHTTPHeaderField: APIConfiguration.appCheckHeader) == nil)
    }

    @Test("Omits the App Check header when a configured provider returns nil")
    func omitsAppCheckHeaderWhenTokenIsNil() async throws {
        let identifier = "appcheck-absent-token"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: nil,
            appCheckTokenProvider: FakeAppCheckTokenProvider(token: nil)
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.value(forHTTPHeaderField: APIConfiguration.appCheckHeader) == nil)
    }

    @Test("Both headers are attached together when both providers return a value")
    func attachesBothHeadersTogether() async throws {
        let identifier = "both-present"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: "id-token-789",
            appCheckTokenProvider: FakeAppCheckTokenProvider(token: "app-check-token-789")
        )

        _ = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-token-789")
        #expect(
            request.value(forHTTPHeaderField: APIConfiguration.appCheckHeader) == "app-check-token-789"
        )
    }

    /// The defect the owner hit on a TestFlight device: every authenticated
    /// screen reported "Something went wrong on our side" against a server
    /// that had never been asked anything.
    ///
    /// `FirebaseAppCheckTokenProvider.currentToken()` throws whenever the SDK
    /// cannot exchange an attestation, which for this project it never can —
    /// `firebaseappcheck.googleapis.com` is not enabled on it. The transport
    /// used to let that throw escape `makeRequest`, so no request was ever
    /// sent and the non-`APIGatewayError` fell into each view model's generic
    /// `catch`. App Check is monitor-only and its header is optional on every
    /// route, so an unobtainable token must degrade the request's
    /// classification, not destroy the request.
    @Test("Sends the request without the App Check header when the App Check provider throws")
    func sendsRequestWhenAppCheckTokenProviderThrows() async throws {
        let identifier = "appcheck-throwing"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, Self.emptyPage),
            authToken: "id-token-abc",
            appCheckTokenProvider: ThrowingAppCheckTokenProvider()
        )

        let page = try await gateway.list(cursor: nil)
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(page.items.isEmpty)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-token-abc")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.appCheckHeader) == nil)
    }

    /// The exact body the deployed API returns to a freshly-authenticated
    /// account that owns no gardens — verified by hand against
    /// `https://verdery-api-dev-…/v1/gardens`, which answers
    /// `200 {"items":[]}`. `nextCursor` is absent, not `null`, because the
    /// server omits an undefined optional field; every other test here uses
    /// the explicit-`null` form, so the shape a real empty account actually
    /// produces had no coverage.
    @Test("Decodes the empty page the server really sends, with nextCursor absent")
    func decodesEmptyPageWithAbsentCursor() async throws {
        let identifier = "empty-page-absent-cursor"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, #"{"items":[]}"#),
            authToken: "id-token-def"
        )

        let page = try await gateway.list(cursor: nil)

        #expect(page.items.isEmpty)
        #expect(page.nextCursor == nil)
    }
}

/// Deterministic correlation identifiers, so a test can assert the header.
private struct FixedCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    let value: String

    func next() -> CorrelationIdentifier {
        CorrelationIdentifier(value: value)
    }
}

private struct FakeAuthTokenProvider: AuthTokenProvider {
    let token: String?

    func currentIdToken() async throws -> String? { token }
}

private struct FakeAppCheckTokenProvider: AppCheckTokenProvider {
    let token: String?

    func currentToken() async throws -> String? { token }
}

/// Stands in for `FirebaseAppCheckTokenProvider` on a build whose project
/// has no App Check registration — which is every build of this app today.
private struct ThrowingAppCheckTokenProvider: AppCheckTokenProvider {
    struct Failure: Error {}

    func currentToken() async throws -> String? { throw Failure() }
}
