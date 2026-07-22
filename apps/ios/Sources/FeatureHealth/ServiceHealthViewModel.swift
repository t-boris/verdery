import CoreDomain
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the service status screen.
///
/// Main-actor isolated because it publishes UI state, small enough to represent
/// one screen, and dependent only on Core abstractions — the template every
/// other feature follows.
///
/// Source: architecture/ios-application-design.md, sections "5.1 Presentation"
/// and "21. Dependency Rules".
@MainActor
@Observable
public final class ServiceHealthViewModel {
    public private(set) var state: ServiceHealthViewState = .idle

    private let checkServiceHealth: CheckServiceHealth
    private let strings: LocalizedStrings

    public init(checkServiceHealth: CheckServiceHealth, strings: LocalizedStrings) {
        self.checkServiceHealth = checkServiceHealth
        self.strings = strings
    }

    public var title: String { strings(.healthTitle) }
    public var refreshActionTitle: String { strings(.healthActionRefresh) }

    public func refresh() async {
        state = .checking

        do {
            state = .loaded(summary(for: try await checkServiceHealth()))
        } catch let failure as APIGatewayError {
            state = .failed(message: message(for: failure))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    private func summary(for health: ServiceHealth) -> ServiceHealthSummary {
        ServiceHealthSummary(
            headline: strings(health.isReady ? .healthStatusReady : .healthStatusNotReady),
            version: strings.string(.healthVersion, parameters: ["version": health.version]),
            unavailableDependencies: health.unavailableDependencies.map { dependency in
                strings.string(
                    .healthDependencyUnavailable,
                    parameters: ["name": dependency.name]
                )
            }
        )
    }

    /// Maps a gateway failure onto text that names a safe next action.
    ///
    /// The correlation identifier is deliberately not shown: it is retained on
    /// the error for a defect report but is meaningless to the reader.
    ///
    /// Source: architecture/ios-application-design.md, section "16. Error Handling".
    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
