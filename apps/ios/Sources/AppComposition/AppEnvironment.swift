import CoreNetworking
import Foundation

/// Where the application points and how it is configured for a build.
///
/// The origin is a build input rather than something a screen can change.
/// Staging and production origins arrive with the delivery work packages; until
/// then the only defined environment is the locally running API.
///
/// Source: architecture/environments-and-delivery.md, section "2. Environments".
public enum AppEnvironment {
    /// The API served by the local development container.
    public static let development = APIConfiguration(origin: developmentOrigin)

    /// A malformed literal here is a build-time defect, not a runtime condition,
    /// so it is not modelled as a recoverable failure.
    private static let developmentOrigin: URL = {
        guard let url = URL(string: "http://localhost:8080") else {
            preconditionFailure("The development API origin literal is not a valid URL.")
        }

        return url
    }()
}
