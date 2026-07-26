import CoreNetworking
import Foundation

/// Where the application points and how it is configured for a build.
///
/// The origin is a build input rather than something a screen can change.
///
/// It is read from the app bundle's `VerderyAPIOrigin` key, which
/// `project.yml` backs with an `API_ORIGIN` build setting, so
/// `xcodebuild … API_ORIGIN=https://api.example.com` selects it per archive
/// without a code change. Until this stage the origin was the literal
/// `http://localhost:8080`, compiled in unconditionally — correct on a
/// development machine and unreachable on a phone, where `localhost` is the
/// phone itself. Every request from a TestFlight build therefore failed at the
/// transport layer, which every screen truthfully but unhelpfully reported as
/// "Something went wrong on our side."
///
/// The fallback stays `http://localhost:8080`, because that is genuinely right
/// for a Simulator build talking to a container on the same machine; what
/// changed is that it is now a default rather than the only possibility.
///
/// Note for whoever configures a real build: an `http://` origin also needs an
/// App Transport Security exception, which this app does not declare. A
/// deployed origin is expected to be `https://`.
///
/// Source: architecture/environments-and-delivery.md, section "2. Environments".
public enum AppEnvironment {
    /// The origin this build was configured with.
    public static let current = APIConfiguration(origin: configuredOrigin)

    /// The API served by the local development container.
    ///
    /// Kept as a named value because it is the documented local default, and
    /// because naming it makes the fallback below read as the deliberate
    /// choice it is rather than as a stray literal.
    public static let development = APIConfiguration(origin: developmentOrigin)

    /// The bundle key `project.yml` fills from the `API_ORIGIN` build setting.
    private static let originInfoPlistKey = "VerderyAPIOrigin"

    /// A malformed literal here is a build-time defect, not a runtime
    /// condition, so it is not modelled as a recoverable failure.
    private static let developmentOrigin: URL = {
        guard let url = URL(string: "http://localhost:8080") else {
            preconditionFailure("The development API origin literal is not a valid URL.")
        }

        return url
    }()

    /// A configured origin is used only when it parses and carries both a
    /// scheme and a host.
    ///
    /// An unsubstituted build setting arrives as the literal `$(API_ORIGIN)`
    /// and an empty one as `""`; neither could ever succeed, and both would
    /// otherwise turn every request into an opaque failure. Falling back is
    /// the honest response — a build pointed nowhere then behaves exactly like
    /// a development build, which is at least a state someone can recognise.
    private static let configuredOrigin: URL = {
        guard
            let configured = Bundle.main.object(forInfoDictionaryKey: originInfoPlistKey) as? String,
            let url = URL(string: configured.trimmingCharacters(in: .whitespacesAndNewlines)),
            url.scheme != nil,
            url.host() != nil
        else {
            return developmentOrigin
        }

        return url
    }()
}
