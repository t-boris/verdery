import CoreDomain
import CoreNetworking
import Foundation

/// In-memory `MediaGateway` stand-in for `FeatureMapTests` — just enough
/// for the plan-background flows: a configurable plan list, per-media
/// status records (with derivatives), and signed-access URLs. Distinct from
/// `CoreMediaTransferTests`' own `FakeMediaGateway`, which models the
/// upload lifecycle this feature never drives.
final class FakeMapMediaGateway: MediaGateway, @unchecked Sendable {
    enum FakeError: Error { case unconfigured }

    var planList: [Media] = []
    var statusById: [String: Media] = [:]
    var accessById: [String: MediaAccess] = [:]
    private(set) var listCalls: [(gardenId: String, mediaClass: MediaClass?)] = []
    private(set) var statusCalls: [String] = []
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

    func getMediaStatus(gardenId _: String, mediaId: String) async throws -> Media {
        statusCalls.append(mediaId)
        guard let media = statusById[mediaId] else { throw FakeError.unconfigured }
        return media
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
        gardenId: String,
        mediaClass: MediaClass?,
        cursor _: String?,
        limit _: Int?
    ) async throws -> MediaListResult {
        listCalls.append((gardenId: gardenId, mediaClass: mediaClass))
        return MediaListResult(items: planList, nextCursor: nil)
    }
}
