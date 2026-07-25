import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the media registration/verification/access
/// operations. Deliberately does NOT expose a method for the actual byte
/// upload: architecture/media-storage-and-processing.md, section
/// "2. Principles" — "Binary media bypasses the interactive API data path" —
/// the client PUTs bytes straight to `MediaUploadSession.uploadUrl`, a raw
/// Cloud Storage resumable-upload session URI, never through this gateway or
/// `HTTPTransport`. `CoreMediaTransfer.MediaUploadCoordinator` is what speaks
/// that separate wire protocol, over its own background `URLSession`.
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `ObservationGateway`/`PlantGateway` exist.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Media`.
public protocol MediaGateway: Sendable {
    /// `POST /gardens/{gardenId}/media`: authorizes garden access, reserves
    /// quota, creates the media record, and opens a backend-authorized
    /// resumable Cloud Storage upload session, in one call.
    func registerMediaUpload(
        gardenId: String,
        mediaClass: MediaClass,
        displayFilename: String,
        declaredContentType: String,
        declaredByteSize: Int64,
        checksumSha256: String?,
        idempotencyKey: String
    ) async throws -> MediaUploadSession

    /// `GET /gardens/{gardenId}/media/{mediaId}`: current status. Any garden
    /// role that can view the garden can read it.
    func getMediaStatus(gardenId: String, mediaId: String) async throws -> Media

    /// `GET /gardens/{gardenId}/media`: the garden's ORIGINAL media records
    /// — never derivative rows — most recently created first, optionally
    /// filtered to one media class (P6-PLAN-01; the plan-import picker
    /// filters to `imported_plan`). `cursor`/`limit` are the contract's
    /// ordinary keyset pagination.
    func listGardenMedia(
        gardenId: String,
        mediaClass: MediaClass?,
        cursor: String?,
        limit: Int?
    ) async throws -> MediaListResult

    /// `POST /gardens/{gardenId}/media/{mediaId}/complete`: verifies a
    /// finished upload and resolves it to `available` or `rejected`.
    /// Idempotent under a duplicate completion notification. `expectedRevision`
    /// is the media record's own revision (from registration or the most
    /// recent status read) — this operation's required `If-Match`
    /// precondition.
    func completeMediaUpload(
        gardenId: String,
        mediaId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Media

    /// `GET /gardens/{gardenId}/media/{mediaId}/access`: a short-lived signed
    /// download URL. Only `available` media can be accessed, and — per
    /// P6-WORKER-01/02's own tightening — only once `processingState ==
    /// .processed` too.
    func getMediaAccess(gardenId: String, mediaId: String) async throws -> MediaAccess
}

/// URLSession-backed implementation of the media registration/verification/
/// access operations, over the same `HTTPTransport` (JSON, `services/api`)
/// every other gateway in this module uses. Never the transport for the
/// actual upload bytes — see this protocol's own doc comment.
public struct URLSessionMediaGateway: MediaGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func registerMediaUpload(
        gardenId: String,
        mediaClass: MediaClass,
        displayFilename: String,
        declaredContentType: String,
        declaredByteSize: Int64,
        checksumSha256: String?,
        idempotencyKey: String
    ) async throws -> MediaUploadSession {
        let result: MediaUploadSessionTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/media",
            body: RegisterMediaUploadRequestTransport(
                mediaClass: mediaClass,
                displayFilename: displayFilename,
                declaredContentType: declaredContentType,
                declaredByteSize: declaredByteSize,
                checksumSha256: checksumSha256
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func getMediaStatus(gardenId: String, mediaId: String) async throws -> Media {
        let result: MediaTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/media/\(mediaId)",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func listGardenMedia(
        gardenId: String,
        mediaClass: MediaClass?,
        cursor: String?,
        limit: Int?
    ) async throws -> MediaListResult {
        // Query built the same way `TaskGateway.listTasksForGarden` builds
        // its `status` filter: every value here is an enum raw value, an
        // opaque server-issued cursor, or an integer — none needs
        // percent-escaping beyond what `APIConfiguration` already applies.
        var query: [String] = []
        if let mediaClass {
            query.append("mediaClass=\(mediaClass.rawValue)")
        }
        if let cursor {
            query.append("cursor=\(cursor)")
        }
        if let limit {
            query.append("limit=\(limit)")
        }
        let path = "gardens/\(gardenId)/media" + (query.isEmpty ? "" : "?" + query.joined(separator: "&"))

        let result: MediaListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func completeMediaUpload(
        gardenId: String,
        mediaId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Media {
        let result: MediaTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/media/\(mediaId)/complete",
            headers: [
                APIConfiguration.idempotencyKeyHeader: idempotencyKey,
                APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
            ],
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func getMediaAccess(gardenId: String, mediaId: String) async throws -> MediaAccess {
        let result: MediaAccessTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/media/\(mediaId)/access",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }
}
