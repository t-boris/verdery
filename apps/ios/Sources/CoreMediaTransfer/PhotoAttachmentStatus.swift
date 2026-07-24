import CoreDomain
import Foundation

/// UI-facing status for one in-progress photo attachment — a small, stable
/// vocabulary a feature view renders directly, derived from a
/// `CoreDomain.MediaTransfer`'s own (larger, persistence-shaped) field set
/// rather than exposing that shape straight to a view the way
/// `CoreSynchronization.SyncEngineStatus` is kept separate from
/// `CorePersistence.OutboxOperationRecord`.
public enum PhotoAttachmentStatus: Equatable, Sendable {
    /// Nothing attached or in progress yet.
    case idle
    /// The file is durably written and the row exists; registration or the
    /// upload itself has not visibly started rendering progress yet.
    case preparing
    /// A transient failure (this device's own connectivity, or a `5xx`/
    /// `429` from the service) is holding this transfer back from automatic
    /// retry until `SyncBackoff`'s window elapses.
    case waitingForConnectivity
    case uploading(progressFraction: Double)
    /// The background upload finished; `CompleteMediaUpload` verification is
    /// in flight.
    case verifying
    /// Upload verified (`uploadState == .available`); an async worker is
    /// still producing derivatives (`processingState == .processing`).
    case processing
    /// Verified and (where applicable) processed — `mediaId` is safe to pass
    /// to `AttachPlantPhoto`/`RecordObservation`'s `photoMediaIds`.
    case ready(mediaId: String)
    /// `CompleteMediaUpload` resolved to `rejected` — a declared/actual
    /// mismatch, or a validation failure the server caught. Not retryable by
    /// resubmitting the same file unchanged.
    case rejected(reasonCode: String?)
    /// A non-transient failure this device cannot resolve by waiting —
    /// authentication/authorization/validation, or a local defect
    /// (`MediaUploadError`). Needs explicit user action (retry after fixing
    /// the underlying cause, or discarding).
    case failed(reasonCode: String?)

    /// Whether `PhotoAttachmentController.retry()` is a meaningful next
    /// action from this status — mirrors `SyncErrorCategory
    /// .isEligibleForAutomaticRetry`'s own "excluded from automatic retry
    /// does not mean excluded from ALL retry" distinction
    /// (architecture/offline-synchronization.md, section "20. Connectivity
    /// and Backoff"): every non-terminal, non-ready status is retryable —
    /// `.rejected` is the only true dead end, since resubmitting the exact
    /// same bytes the server just rejected cannot succeed.
    public var isRetryable: Bool {
        switch self {
        case .rejected: false
        case .ready: false
        default: true
        }
    }

    static func from(_ transfer: MediaTransfer) -> PhotoAttachmentStatus {
        switch transfer.state {
        case .captured, .registered, .queued:
            transfer.retryState.lastErrorCategory == .connectivity ? .waitingForConnectivity : .preparing

        case .uploading:
            .uploading(progressFraction: progressFraction(for: transfer))

        case .verifying:
            .verifying

        case .retained:
            if let mediaId = transfer.mediaId {
                if transfer.serverProcessingState == MediaProcessingState.processing.rawValue {
                    .processing
                } else {
                    .ready(mediaId: mediaId)
                }
            } else {
                // Unreachable in practice — `.retained` is only ever reached
                // right after `CompleteMediaUpload` succeeds, which always
                // carries a `mediaId` by then — but a stale/corrupt local
                // row should degrade to "still working," not crash a view.
                .verifying
            }

        case .deleted:
            .idle

        case .failed:
            transfer.serverUploadState == MediaUploadState.rejected.rawValue
                ? .rejected(reasonCode: transfer.failureReason)
                : .failed(reasonCode: transfer.failureReason)

        case .recoverable:
            transfer.retryState.lastErrorCategory == .connectivity ? .waitingForConnectivity : .failed(reasonCode: transfer.failureReason)
        }
    }

    private static func progressFraction(for transfer: MediaTransfer) -> Double {
        guard let total = transfer.byteCount, total > 0 else { return 0 }
        return min(max(Double(transfer.bytesSent) / Double(total), 0), 1)
    }
}
