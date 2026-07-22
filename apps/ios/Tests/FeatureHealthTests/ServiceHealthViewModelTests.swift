import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureHealth

/// The feature is tested through its gateway protocol, with no URLSession and no
/// server. That is the property the dependency rule exists to protect.
///
/// Source: architecture/ios-application-design.md, section "19. Testing".
private struct StubHealthGateway: HealthGateway {
    let result: Result<ServiceHealth, APIGatewayError>

    func liveness() async throws -> ServiceLiveness {
        ServiceLiveness(version: "1.4.0")
    }

    func readiness() async throws -> ServiceHealth {
        try result.get()
    }
}

@MainActor
@Suite("Service health view model")
struct ServiceHealthViewModelTests {
    private func makeModel(
        _ result: Result<ServiceHealth, APIGatewayError>
    ) -> ServiceHealthViewModel {
        ServiceHealthViewModel(
            checkServiceHealth: CheckServiceHealth(gateway: StubHealthGateway(result: result)),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("Starts idle so nothing is claimed before a check runs")
    func startsIdle() {
        #expect(makeModel(.success(.readyFixture)).state == .idle)
    }

    @Test("A ready service is summarized with its version")
    func summarizesReadyService() async {
        let model = makeModel(.success(.readyFixture))

        await model.refresh()

        #expect(
            model.state
                == .loaded(
                    ServiceHealthSummary(
                        headline: "The service is ready.",
                        version: "Version 1.4.0",
                        unavailableDependencies: []
                    )
                )
        )
    }

    @Test("Unavailable dependencies are listed one line each")
    func listsUnavailableDependencies() async {
        let model = makeModel(.success(.degradedFixture))

        await model.refresh()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected a loaded state, received \(model.state).")
            return
        }

        #expect(summary.headline == "The service is not ready.")
        #expect(summary.unavailableDependencies == ["database is unavailable."])
    }

    /// A connectivity failure names an action the user can take. It never shows a
    /// status code or a correlation identifier.
    @Test("A connectivity failure becomes actionable text")
    func reportsConnectivityFailure() async {
        let model = makeModel(
            .failure(.transport(code: .notConnectedToInternet, correlationId: "c-1"))
        )

        await model.refresh()

        #expect(
            model.state
                == .failed(
                    message:
                        "Verdery cannot reach the server. Check your connection and try again."
                )
        )
    }

    @Test("A server failure does not leak the correlation identifier")
    func hidesCorrelationIdentifier() async {
        let model = makeModel(.failure(.unexpectedStatus(502, correlationId: "c-2")))

        await model.refresh()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected a failed state, received \(model.state).")
            return
        }

        #expect(!message.contains("c-2"))
        #expect(!message.contains("502"))
    }
}

extension ServiceHealth {
    fileprivate static let readyFixture = ServiceHealth(
        readiness: .ready,
        version: "1.4.0",
        dependencies: [ServiceHealth.Dependency(name: "database", availability: .available)]
    )

    fileprivate static let degradedFixture = ServiceHealth(
        readiness: .notReady,
        version: "1.4.0",
        dependencies: [
            ServiceHealth.Dependency(
                name: "database",
                availability: .unavailable,
                detail: "connection refused"
            )
        ]
    )
}
