import CoreLocalization
import CoreNetworking
import CoreObservability
import Foundation
import FeatureHealth

/// The single place where adapters are constructed and injected.
///
/// Nothing else in the application resolves a dependency: features receive
/// theirs through explicit initializers, which is what keeps them independently
/// testable and keeps URLSession out of view code.
///
/// Source: architecture/ios-application-design.md, sections "5.4 Infrastructure"
/// and "21. Dependency Rules".
@MainActor
public final class AppCompositionRoot {
    private let strings: LocalizedStrings
    private let healthGateway: any HealthGateway

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        locale: Locale = .autoupdatingCurrent,
        log: any DiagnosticLog = SystemDiagnosticLog(
            subsystem: "com.verdery.app",
            category: "networking"
        )
    ) {
        self.strings = LocalizedStrings(locale: locale)
        self.healthGateway = URLSessionHealthGateway(
            configuration: configuration,
            session: session,
            log: log
        )
    }

    public func makeServiceHealthViewModel() -> ServiceHealthViewModel {
        ServiceHealthViewModel(
            checkServiceHealth: CheckServiceHealth(gateway: healthGateway),
            strings: strings
        )
    }
}
