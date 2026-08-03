import CoreDomain
import CoreNetworking
import Foundation

/// In-memory `MediaGateway` stand-in for `FeatureObservationsTests` — just
/// enough for the journal sequence: scriptable signed-access URLs keyed by
/// `mediaId`. A third copy alongside `FeaturePlantsTests`' and
/// `FeatureMapTests`' own, because a test target may not import another
/// feature's test target and each models only the calls its own feature makes.
final class FakeObservationsMediaGateway: MediaGateway, @unchecked Sendable {
    enum FakeError: Error { case unconfigured }

    var accessById: [String: MediaAccess] = [:]
    private(set) var accessCalls: [String] = []

    init() {}

    func registerMediaUpload(
        gardenId _: String,
        mediaClass _: MediaClass,
        displayFilename _: String,
        declaredContentType _: String,
        declaredByteSize _: Int64,
        checksumSha256 _: String?,
        idempotencyKey _: String
    ) async throws -> MediaUploadSession {
        throw FakeError.unconfigured
    }

    func getMediaStatus(gardenId _: String, mediaId _: String) async throws -> Media {
        throw FakeError.unconfigured
    }

    func completeMediaUpload(
        gardenId _: String,
        mediaId _: String,
        expectedRevision _: Int,
        idempotencyKey _: String
    ) async throws -> Media {
        throw FakeError.unconfigured
    }

    func getMediaAccess(gardenId _: String, mediaId: String) async throws -> MediaAccess {
        accessCalls.append(mediaId)
        guard let access = accessById[mediaId] else { throw FakeError.unconfigured }
        return access
    }

    func listGardenMedia(
        gardenId _: String,
        mediaClass _: MediaClass?,
        cursor _: String?,
        limit _: Int?
    ) async throws -> MediaListResult {
        MediaListResult(items: [], nextCursor: nil)
    }
}
