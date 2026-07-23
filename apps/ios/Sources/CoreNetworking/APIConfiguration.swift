import Foundation

/// Everything the API gateway needs that varies between environments.
///
/// Configuration is injected from the composition root rather than read from a
/// global, so a test can point the same gateway at a stub without mutating
/// process state.
///
/// Source: architecture/ios-application-design.md, section "5.4 Infrastructure".
public struct APIConfiguration: Equatable, Sendable {
    /// Origin of the API, without the version path segment.
    public let origin: URL

    /// Timeout applied to every request.
    ///
    /// The architecture requires explicit timeouts; URLSession's 60 second
    /// default is far too long for a health probe behind a user-visible screen.
    ///
    /// Source: architecture/ios-application-design.md, section "9. Networking".
    public let requestTimeout: TimeInterval

    public init(origin: URL, requestTimeout: TimeInterval = 10) {
        self.origin = origin
        self.requestTimeout = requestTimeout
    }

    /// The API base path. Breaking changes require a new major path.
    ///
    /// Source: packages/api-contracts, `API_BASE_PATH`.
    public static let basePath = "/v1"

    /// Header carrying the client-generated idempotency key on retryable mutations.
    public static let idempotencyKeyHeader = "Idempotency-Key"

    /// Header carrying the expected revision on revision-sensitive operations.
    public static let ifMatchHeader = "If-Match"

    /// Header carrying the client-generated correlation identifier.
    ///
    /// The OpenAPI document does not yet name this header; the response envelope
    /// only returns `correlationId`. This client convention is provisional and
    /// is replaced by the contract's name when `P1-OBS-01` pins it.
    public static let correlationIdHeader = "X-Correlation-Id"

    /// Header carrying the Firebase App Check token, the conventional name the
    /// backend reads for traffic classification.
    ///
    /// Source: architecture/identity-and-authorization.md, section "12. App Check".
    public static let appCheckHeader = "X-Firebase-AppCheck"

    /// Builds the absolute URL of a versioned operation path such as
    /// `health/live`, or `gardens?cursor=...` / `gardens/1/tasks?status=a,b`.
    ///
    /// A `?` in `path` is split off and attached as the URL's actual query
    /// component (via `percentEncodedQuery`) rather than left for
    /// `appendingPathComponent` to absorb into the path segment — which is
    /// what it does with anything after `?`, silently: it neither splits nor
    /// rejects it, it just encodes the whole string, query-looking suffix
    /// included, as one literal path component, leaving `URL.query` `nil`.
    /// Confirmed directly: a gateway call built exactly this way decoded a
    /// server-facing path of `.../taxonomy-references?query=tomato&limit=10`
    /// with no `?` in sight to a request whose `query` was `nil`. Callers
    /// that build a query string (`GardenGateway.list(cursor:)`,
    /// `PlantGateway.searchTaxonomyReferences`, ...) already percent-encode
    /// each value themselves before embedding it, so the split-off query
    /// string is applied via `percentEncodedQuery`, not `query`, to avoid
    /// double-encoding it.
    public func url(forOperationPath path: String) -> URL {
        let trimmedBasePath = Self.basePath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let originWithBasePath = origin.appendingPathComponent(trimmedBasePath)

        guard let queryIndex = path.firstIndex(of: "?") else {
            return originWithBasePath.appendingPathComponent(path)
        }

        let pathOnly = String(path[path.startIndex..<queryIndex])
        let queryString = String(path[path.index(after: queryIndex)...])
        let pathURL = originWithBasePath.appendingPathComponent(pathOnly)

        guard var components = URLComponents(url: pathURL, resolvingAgainstBaseURL: false) else {
            return pathURL
        }
        components.percentEncodedQuery = queryString
        return components.url ?? pathURL
    }
}
