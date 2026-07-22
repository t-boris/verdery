import Testing

@testable import CoreNetworking

@Suite("Shared error codes")
struct SharedErrorCodeTests {
    /// The catalogue is duplicated from `packages/api-contracts` because Swift
    /// cannot import TypeScript. This test states the expected raw values
    /// literally, so drift on either side fails here rather than turning into a
    /// silently unrecognized error at runtime.
    @Test("Raw values match the contract catalogue")
    func matchesContract() {
        let expected: [SharedErrorCode: String] = [
            .requestInvalid: "request.invalid",
            .requestTooLarge: "request.too_large",
            .idempotencyKeyReused: "request.idempotency.key_reused",
            .unauthenticated: "auth.unauthenticated",
            .forbidden: "auth.forbidden",
            .staleRevision: "concurrency.stale_revision",
            .rateLimited: "quota.rate_limited",
            .internalFailure: "server.internal",
            .dependencyUnavailable: "server.dependency_unavailable",
        ]

        #expect(expected.count == SharedErrorCode.allCases.count)

        for (code, rawValue) in expected {
            #expect(code.rawValue == rawValue)
        }
    }

    @Test("A module code is not mistaken for a shared code")
    func ignoresModuleCodes() {
        #expect(SharedErrorCode(rawValue: "garden.geometry.stale_revision") == nil)
    }
}
