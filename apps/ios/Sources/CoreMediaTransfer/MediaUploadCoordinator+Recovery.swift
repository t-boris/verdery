import CoreDomain
import Foundation

extension MediaUploadCoordinator {
    /// Recovers every non-terminal transfer after a relaunch — `start()`'s
    /// own second responsibility, after subscribing to
    /// `uploadTransport.events`. Real background transfers survive both app
    /// suspension and app termination; this is what lets a fresh process
    /// pick their results back up instead of either losing them or
    /// duplicating them.
    ///
    /// Per state:
    /// - `.uploading` with a task the OS kept alive
    ///   (`uploadTransport.recoverInFlightTasks`): left alone — its outcome
    ///   arrives through `events` once delivered, exactly as if this process
    ///   had never restarted.
    /// - `.uploading` with NO surviving task (the rare case where even the
    ///   background daemon lost track of it): resumed through the real
    ///   Cloud Storage status-check-and-resume path
    ///   (`resumeAfterInterruption`), not a blind full re-upload.
    /// - `.verifying`: the bytes were fully sent, but this device never
    ///   confirmed completion before the prior process ended —
    ///   `completeUpload` is idempotent under a duplicate completion
    ///   notification, safe to call again.
    /// - `.captured`/`.registered`/`.queued`/`.recoverable`: driven forward
    ///   through the ordinary automatic-retry path (`driveUpload`), subject
    ///   to the same category/backoff gating any other automatic attempt is.
    /// - `.failed`: left exactly where it is — the same "needs explicit user
    ///   action, not more automatic attempts" reasoning `driveUpload`'s own
    ///   category gate already applies.
    ///
    /// One deliberate, documented gap: a `.retained` transfer whose
    /// `processingState` was still `.processing` when the prior process
    /// ended does not resume its bounded poll automatically here — only
    /// `completeUpload`'s own success path starts one. `PhotoAttachmentController
    /// .refreshStatus(transferId:)` (an explicit `GetMediaStatus` call) is
    /// the manual fallback a view can offer; adding a second automatic
    /// poll-resumption path for an already-durable, already-`available`
    /// record was judged a smaller win than the added complexity, since
    /// nothing about the photo's SAFETY depends on it (only the moment its
    /// authorized preview becomes renderable).
    func recoverInFlightTransfers() async {
        guard let pending = try? await transferStore.fetchAllPending() else { return }

        var uploadUrlsByTransferId: [String: URL] = [:]
        for transfer in pending where transfer.state == .uploading {
            if let uploadUrlString = transfer.uploadUrl, let url = URL(string: uploadUrlString) {
                uploadUrlsByTransferId[transfer.id] = url
            }
        }
        let stillInFlight = await uploadTransport.recoverInFlightTasks(
            matchingUploadUrlsByTransferId: uploadUrlsByTransferId
        )

        for transfer in pending {
            switch transfer.state {
            case .uploading where stillInFlight.contains(transfer.id):
                continue

            case .uploading:
                await resumeAfterInterruption(transferId: transfer.id)

            case .verifying:
                await completeUpload(transferId: transfer.id)

            case .captured, .registered, .queued, .recoverable:
                await driveUpload(transferId: transfer.id, bypassingAutomaticRetryGate: false)

            case .failed, .retained, .deleted:
                continue
            }
        }
    }
}
