import CoreDomain
import CoreNetworking
import CoreSynchronization
import Foundation

extension MediaUploadCoordinator {
    /// `POST /gardens/{gardenId}/media`: obtains a Cloud Storage resumable
    /// upload session for `transferId`, persisting `mediaId`/`uploadUrl`/
    /// `uploadUrlExpiresAt`/`mediaRevision` on success.
    ///
    /// `idempotencyKey` is deterministic — `transferId` itself, already a
    /// UUID — for an ordinary retry of the SAME registration attempt (a
    /// transient failure before any response arrived): architecture/
    /// ios-application-design.md, section "9. Networking" requires an
    /// idempotency key precisely so a retried request that actually
    /// succeeded server-side, whose response this device never received,
    /// does not register a second media record and a second quota
    /// reservation. The server's own idempotency store scopes a key by
    /// `(actorProfileId, operation, idempotencyKey)` (`services/api`'s
    /// `IdempotencyStore`), so reusing the same bare `transferId` here and in
    /// `completeUpload`'s own idempotency key never collides — the two calls
    /// are different operations. Every request carrying this header
    /// throughout this codebase is a bare UUID (`CoreNetworking`'s other
    /// gateways all pass `UUIDv7.generate()` directly); this one is no
    /// exception; the server's route-level check rejects anything else with
    /// a `400`, per `media-routes.ts`'s own `requireIdempotencyKey`.
    /// `forceNewSession: true` mints a genuinely fresh (`UUIDv7`-based) key
    /// instead — see `beginOrResumeUpload`'s own doc comment for the one
    /// case that needs to (a session whose 1-hour TTL expired before the
    /// upload ever finished): reusing the ORIGINAL key with the identical
    /// request body would only ever replay the SAME now-expired session back
    /// (`services/api`'s idempotency store returns the prior outcome
    /// verbatim for a repeated key+payload), never issuing a new one — a
    /// deliberately different key is the only way to obtain a genuinely new
    /// media record and session. The abandoned original media record
    /// becomes an orphan `registered`/`authorized` row server-side;
    /// architecture/media-storage-and-processing.md, section "17. Quotas":
    /// "A failed abandoned upload eventually releases reserved capacity" —
    /// an accepted, documented outcome, not a leak this client must itself
    /// clean up.
    func register(transferId: String, forceNewSession: Bool) async throws -> MediaTransfer {
        guard let transfer = try await transferStore.fetch(id: transferId) else {
            throw MediaUploadError.transferNotFound
        }

        let idempotencyKey = forceNewSession ? generateId() : transferId

        do {
            let session = try await gateway.registerMediaUpload(
                gardenId: transfer.gardenId,
                mediaClass: transfer.mediaClass,
                displayFilename: transfer.displayFilename,
                declaredContentType: transfer.declaredContentType,
                declaredByteSize: transfer.declaredByteSize,
                checksumSha256: transfer.checksum,
                idempotencyKey: idempotencyKey
            )

            let registered = transfer.updating(
                state: .queued,
                retryState: RetryState(),
                updatedAt: now(),
                mediaId: session.media.id,
                uploadUrl: session.uploadUrl.absoluteString,
                uploadUrlExpiresAt: session.uploadUrlExpiresAt,
                mediaRevision: session.media.revision,
                bytesSent: 0,
                serverUploadState: session.media.uploadState.rawValue,
                failureReason: nil
            )
            try await transferStore.save(registered)
            broadcast(registered)
            return registered
        } catch let error as APIGatewayError {
            try await recordGatewayFailure(error, transfer: transfer)
            throw error
        }
    }
}
