import CoreDomain
import CoreNetworking
import Foundation

extension MediaUploadCoordinator {
    /// `POST /gardens/{gardenId}/media/{mediaId}/complete`: explicit,
    /// client-triggered verification. Idempotent under a duplicate
    /// completion notification (the contract's own guarantee) — safe to call
    /// again during recovery for a transfer this device already finished
    /// uploading but never confirmed completion for before a prior process
    /// ended.
    ///
    /// `idempotencyKey` is `transferId` itself (a bare UUID, matching every
    /// other `CoreNetworking` gateway call and the server's own
    /// `requireIdempotencyKey` check — see `register`'s own doc comment for
    /// why a prefixed string fails that check with a `400`). Safe to reuse
    /// the same value `register` used: the server's idempotency store scopes
    /// by `(actorProfileId, operation, idempotencyKey)`, and this is a
    /// different operation.
    ///
    /// Both of `CompleteMediaUpload`'s outcomes (`available`/`rejected`) are
    /// a successful `200` response, never a thrown `APIGatewayError` — see
    /// that endpoint's own `openapi.yaml` description. `available` advances
    /// this row to `.retained` and starts the bounded processing poll below;
    /// `rejected` is a genuine terminal failure, routed through
    /// `recordTerminalFailure` the same as an explicitly-rejecting upload
    /// status.
    func completeUpload(transferId: String) async {
        guard
            let transfer = try? await transferStore.fetch(id: transferId),
            let mediaId = transfer.mediaId,
            let expectedRevision = transfer.mediaRevision
        else { return }

        do {
            let media = try await gateway.completeMediaUpload(
                gardenId: transfer.gardenId,
                mediaId: mediaId,
                expectedRevision: expectedRevision,
                idempotencyKey: transferId
            )

            switch media.uploadState {
            case .available:
                let retained = transfer.updating(
                    state: .retained,
                    retryState: RetryState(),
                    updatedAt: now(),
                    serverConfirmedAt: now(),
                    mediaRevision: media.revision,
                    serverUploadState: media.uploadState.rawValue,
                    serverProcessingState: media.processingState?.rawValue,
                    failureReason: nil
                )
                try await transferStore.save(retained)
                broadcast(retained)

                if media.processingState == .processing {
                    Task { [weak self] in await self?.pollProcessing(transferId: transferId) }
                }

            case .rejected:
                try await recordTerminalFailure(
                    transfer: transfer,
                    reason: "media.upload.rejected",
                    serverUploadState: media.uploadState.rawValue
                )

            default:
                // Not a state `CompleteMediaUpload` can actually return per
                // its own contract (`registered`/`authorized`/`uploading`/
                // `verifying` are transient states this synchronous call
                // resolves THROUGH, never returns as its own result;
                // `deletion_scheduled`/`deleted` cannot apply to a record
                // this device only just finished uploading). Recorded
                // defensively rather than silently dropped, in case a future
                // contract revision adds a state this switch has not been
                // updated for.
                log.record(.error, "CompleteMediaUpload returned an unexpected uploadState.")
            }
        } catch let error as APIGatewayError {
            try? await recordGatewayFailure(error, transfer: transfer)
        } catch {
            try? await recordFailure(transfer: transfer, category: .unknown, reason: "unknown")
        }
    }

    /// Bounded automatic polling of `GET /gardens/{gardenId}/media/{mediaId}`
    /// for `processingState` to leave `.processing` — architecture/media-
    /// storage-and-processing.md, section "9. Image Derivatives": derivative
    /// generation is an ASYNC worker job (P6-WORKER-01/02), with no push
    /// notification back to this client when it finishes, so polling is the
    /// only way this coordinator can observe the transition on its own.
    ///
    /// Deliberately bounded (`maxProcessingPollAttempts`, default 6), not an
    /// unbounded loop: an async worker's own completion time is outside this
    /// client's control, and a photo/plan document is fully usable
    /// (`GetMediaAccess`'s own gate, once P6-WORKER-01/02's tightening
    /// applies) once processed regardless of how long that takes — this
    /// coordinator's job is to notice the common case promptly, not to hold
    /// a task alive indefinitely for a worst case. `serverProcessingState`
    /// simply stays `"processing"` on the row after the bound is reached;
    /// `PhotoAttachmentController`'s own manual refresh
    /// (`refreshStatus(transferId:)`) can pick up the eventual transition
    /// any time after that with no separate mechanism needed.
    func pollProcessing(transferId: String) async {
        for attempt in 1...maxProcessingPollAttempts {
            await sleep(pollDelay(forAttempt: attempt))

            guard let transfer = try? await transferStore.fetch(id: transferId), transfer.state == .retained else { return }

            guard let mediaId = transfer.mediaId else { return }
            guard let media = try? await gateway.getMediaStatus(gardenId: transfer.gardenId, mediaId: mediaId) else {
                continue
            }

            let updated = transfer.updating(
                state: .retained,
                retryState: transfer.retryState,
                updatedAt: now(),
                mediaRevision: media.revision,
                serverUploadState: media.uploadState.rawValue,
                serverProcessingState: media.processingState?.rawValue
            )
            try? await transferStore.save(updated)
            broadcast(updated)

            if media.processingState != .processing {
                return
            }
        }
    }

    /// A short, fixed poll cadence rather than `SyncBackoff`'s exponential
    /// curve: this is not retrying a FAILURE (`SyncBackoff`'s own purpose),
    /// it is waiting out an async job's own typically-short real duration —
    /// a flat few seconds between checks is simpler and matches the actual
    /// shape of the wait.
    private func pollDelay(forAttempt attempt: Int) -> TimeInterval {
        min(TimeInterval(attempt) * 3, 15)
    }
}
