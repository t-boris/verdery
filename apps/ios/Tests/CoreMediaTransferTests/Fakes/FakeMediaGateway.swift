import CoreDomain
import CoreNetworking
import Foundation

@testable import CoreMediaTransfer

/// A configurable `MediaGateway` test double — an actor so every call is
/// serialized the same way the real `URLSessionMediaGateway`'s own calls
/// are, with no manual locking needed. Handlers are set through explicit
/// `set*Handler` methods, not direct property assignment: Swift's actor
/// isolation allows an external caller to `await` a property READ, but not
/// a bare `await actor.property = value` WRITE — a method call is the
/// correct, compiler-accepted shape for a cross-actor mutation.
actor FakeMediaGateway: MediaGateway {
    struct RegisterCall: Equatable {
        let gardenId: String
        let declaredByteSize: Int64
        let idempotencyKey: String
    }

    struct CompleteCall: Equatable {
        let gardenId: String
        let mediaId: String
        let expectedRevision: Int
        let idempotencyKey: String
    }

    enum FakeError: Error { case unconfigured }

    private(set) var registerCalls: [RegisterCall] = []
    private(set) var completeCalls: [CompleteCall] = []
    private(set) var statusCalls: [String] = []

    /// `attemptNumber` is this call's own 1-based ordinal among every
    /// `registerMediaUpload` call this fake has received so far — lets a
    /// test vary its response across successive calls (e.g. "the session
    /// registration returns an already-expired session" tests) with no
    /// mutable state of the test's own to synchronize.
    private var registerHandler: (@Sendable (RegisterCall, _ attemptNumber: Int) -> Result<MediaUploadSession, Error>)?
    private var completeHandler: (@Sendable (CompleteCall) -> Result<Media, Error>)?
    private var statusHandler: (@Sendable (String) -> Result<Media, Error>)?
    private var accessHandler: (@Sendable (String) -> Result<MediaAccess, Error>)?

    func setRegisterHandler(_ handler: @escaping @Sendable (RegisterCall, _ attemptNumber: Int) -> Result<MediaUploadSession, Error>) {
        registerHandler = handler
    }

    /// Convenience for the common case: every attempt returns the same
    /// fixed result, regardless of ordinal.
    func setRegisterHandler(_ handler: @escaping @Sendable (RegisterCall) -> Result<MediaUploadSession, Error>) {
        registerHandler = { call, _ in handler(call) }
    }

    func setCompleteHandler(_ handler: @escaping @Sendable (CompleteCall) -> Result<Media, Error>) {
        completeHandler = handler
    }

    func setStatusHandler(_ handler: @escaping @Sendable (String) -> Result<Media, Error>) {
        statusHandler = handler
    }

    func setAccessHandler(_ handler: @escaping @Sendable (String) -> Result<MediaAccess, Error>) {
        accessHandler = handler
    }

    func registerMediaUpload(
        gardenId: String,
        mediaClass _: MediaClass,
        displayFilename _: String,
        declaredContentType _: String,
        declaredByteSize: Int64,
        checksumSha256 _: String?,
        idempotencyKey: String
    ) async throws -> MediaUploadSession {
        let call = RegisterCall(gardenId: gardenId, declaredByteSize: declaredByteSize, idempotencyKey: idempotencyKey)
        registerCalls.append(call)
        guard let registerHandler else { throw FakeError.unconfigured }
        return try registerHandler(call, registerCalls.count).get()
    }

    func getMediaStatus(gardenId _: String, mediaId: String) async throws -> Media {
        statusCalls.append(mediaId)
        guard let statusHandler else { throw FakeError.unconfigured }
        return try statusHandler(mediaId).get()
    }

    func completeMediaUpload(
        gardenId: String,
        mediaId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Media {
        let call = CompleteCall(gardenId: gardenId, mediaId: mediaId, expectedRevision: expectedRevision, idempotencyKey: idempotencyKey)
        completeCalls.append(call)
        guard let completeHandler else { throw FakeError.unconfigured }
        return try completeHandler(call).get()
    }

    func getMediaAccess(gardenId _: String, mediaId: String) async throws -> MediaAccess {
        guard let accessHandler else { throw FakeError.unconfigured }
        return try accessHandler(mediaId).get()
    }

    /// Nothing in `CoreMediaTransfer` lists media — the upload coordinator
    /// only registers, completes, and polls status — so no test configures
    /// this; an empty page is the honest inert response (P6-PLAN-01 added
    /// the operation for the map editor's plan picker).
    func listGardenMedia(
        gardenId _: String,
        mediaClass _: MediaClass?,
        cursor _: String?,
        limit _: Int?
    ) async throws -> MediaListResult {
        MediaListResult(items: [], nextCursor: nil)
    }
}

/// Builds a `MediaUploadSession`/`Media` fixture with sensible defaults, so
/// each test overrides only the fields it cares about.
extension Media {
    static func fixture(
        id: String = "media-1",
        gardenId: String = "garden-1",
        uploadState: MediaUploadState = .authorized,
        processingState: MediaProcessingState? = nil,
        revision: Int = 1
    ) -> Media {
        Media(
            id: id,
            gardenId: gardenId,
            uploadedByProfileId: "profile-1",
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            declaredContentType: "image/jpeg",
            verifiedContentType: nil,
            declaredByteSize: 1024,
            verifiedByteSize: nil,
            checksumSha256: nil,
            uploadState: uploadState,
            processingState: processingState,
            sensitivityClassification: .standard,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }
}

extension MediaUploadSession {
    /// `expiresAt` defaults far in the future (not a real 1-hour TTL from
    /// "now") deliberately: `MediaUploadCoordinatorTests`'s own default
    /// `now()` fixture clock reads `Date(timeIntervalSince1970: 1_000_000)`,
    /// and a fixture whose default `expiresAt` looked "expired" relative to
    /// that clock would make `beginOrResumeUpload`'s own expiry check
    /// correctly, but confusingly, treat every ordinary happy-path test as
    /// an already-expired session — exactly the defect this default once
    /// had, caught by `happyPathReachesRetained` hanging instead of
    /// completing.
    static func fixture(
        mediaId: String = "media-1",
        uploadUrl: URL = URL(string: "https://storage.googleapis.com/upload/media-1")!,
        expiresAt: Date = Date(timeIntervalSince1970: 10_000_000),
        revision: Int = 1
    ) -> MediaUploadSession {
        MediaUploadSession(
            media: .fixture(id: mediaId, uploadState: .authorized, revision: revision),
            uploadUrl: uploadUrl,
            uploadUrlExpiresAt: expiresAt
        )
    }
}
