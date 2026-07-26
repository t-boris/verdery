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

    /// Where an emailed sign-in link sends the reader.
    ///
    /// The web application already serves a working handler at
    /// `/auth/email-link`, and `apps/web/core/auth/sign-in.ts` already points
    /// its own links there by deriving the origin from the browser it runs
    /// in. This client has no `location.origin` to derive one from, so the
    /// web origin is a build input exactly like `VerderyAPIOrigin` above,
    /// filled from the `WEB_ORIGIN` build setting.
    ///
    /// This app cannot yet *capture* the link itself: doing so needs an
    /// Associated Domains entitlement (`applinks:` for this host), an
    /// `apple-app-site-association` document served by the host, and the
    /// `ASSOCIATED_DOMAINS` capability on the `com.verdery.app` App ID, which
    /// carries only `IN_APP_PURCHASE` and `APPLE_ID_AUTH` today. Landing in a
    /// browser on a page that completes the sign-in is the honest, working
    /// behavior until then — and is strictly better than the previous
    /// hard-coded `https://verdery-dev.firebaseapp.com/emailSignIn`, which no
    /// site has ever served.
    public static let emailSignInContinueURL = webOrigin.appendingPathComponent("auth/email-link")

    /// The bundle key `project.yml` fills from the `API_ORIGIN` build setting.
    private static let originInfoPlistKey = "VerderyAPIOrigin"

    /// The bundle key `project.yml` fills from the `WEB_ORIGIN` build setting.
    private static let webOriginInfoPlistKey = "VerderyWebOrigin"

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

    /// Unlike `configuredOrigin`, this does NOT fall back to a localhost
    /// development value, and the difference is deliberate. An emailed link
    /// is opened wherever the reader reads their mail — another device, days
    /// later — so a `localhost` continue URL is not merely wrong for a
    /// device build, it is unreachable for every reader in every build,
    /// including on the developer's own machine. The deployed development
    /// web application is the only value that is never actively broken, so
    /// it is the fallback; a build that means something else sets
    /// `WEB_ORIGIN`.
    private static let deployedWebOrigin: URL = {
        guard let url = URL(string: "https://verdery-web-dev-t6amsr5o6a-uc.a.run.app") else {
            preconditionFailure("The deployed web origin literal is not a valid URL.")
        }

        return url
    }()

    /// Same validation rule as `configuredOrigin`: an unsubstituted
    /// `$(WEB_ORIGIN)` or an empty string is not a usable origin.
    private static let webOrigin: URL = {
        guard
            let configured = Bundle.main.object(forInfoDictionaryKey: webOriginInfoPlistKey) as? String,
            let url = URL(string: configured.trimmingCharacters(in: .whitespacesAndNewlines)),
            url.scheme != nil,
            url.host() != nil
        else {
            return deployedWebOrigin
        }

        return url
    }()
}
