import CoreDomain
import CoreNetworking
import CoreObservability
import CoreSynchronization
import Foundation

extension MediaUploadCoordinator {
    /// A genuine gateway-layer failure from `MediaGateway`
    /// (register/complete/status) — classified into `CoreDomain
    /// .SyncErrorCategory` via `CoreSynchronization`'s own established
    /// `APIGatewayError.syncErrorCategory` mapping, then routed to either
    /// the automatically-retryable `.recoverable` branch or the needs-
    /// user-action `.failed` branch, exactly the discipline
    /// `SyncErrorCategory.isEligibleForAutomaticRetry`'s own doc comment
    /// already establishes for the sync outbox — reused here rather than
    /// re-derived (see this target's own `Package.swift` comment).
    func recordGatewayFailure(_ error: APIGatewayError, transfer: MediaTransfer) async throws {
        let category = error.syncErrorCategory
        try await recordFailure(transfer: transfer, category: category, reason: category.rawValue)
    }

    /// A transport-level failure from the background upload PUT itself
    /// (`URLError`, never an `APIGatewayError` — the upload bypasses
    /// `HTTPTransport` entirely) — classified directly to `.connectivity`,
    /// the same category `APIGatewayError.syncErrorCategory` gives every
    /// `URLError` case, since a raw `PUT` to Cloud Storage carries no
    /// contract error envelope to classify more precisely from.
    func recordTransportFailure(transfer: MediaTransfer) async throws {
        try await recordFailure(transfer: transfer, category: .connectivity, reason: SyncErrorCategory.connectivity.rawValue)
    }

    func recordFailure(transfer: MediaTransfer, category: SyncErrorCategory, reason: String) async throws {
        let updatedRetryState = transfer.retryState.recordingAttempt(errorCategory: category, at: now())
        let nextState: MediaTransferState = category.isEligibleForAutomaticRetry ? .recoverable : .failed
        let updated = transfer.updating(
            state: nextState,
            retryState: updatedRetryState,
            updatedAt: now(),
            failureReason: reason
        )
        try await transferStore.save(updated)
        broadcast(updated)
        log.record(.warning, "Media transfer failed, category \(reason).")
    }

    /// A terminal, explicit outcome with no gateway error to classify at all
    /// — `CompleteMediaUpload` resolving `rejected`, or Cloud Storage
    /// answering the upload `PUT` with a definitively non-retryable `4xx`.
    /// Always `.failed`, never `.recoverable`: resubmitting the identical
    /// bytes the server just explicitly rejected cannot succeed differently.
    ///
    /// `serverUploadState`, when supplied, is `CoreDomain.MediaUploadState
    /// .rejected.rawValue` for a real `CompleteMediaUpload` rejection —
    /// `PhotoAttachmentStatus.from`'s own only way to distinguish "the
    /// server explicitly rejected this" (`.rejected`, not retryable by
    /// resubmitting the same bytes) from every other non-retryable failure
    /// (`.failed`, `reasonCode` alone). `nil` for a failure this coordinator
    /// classified itself with no `Media` record to read a real
    /// `uploadState` from at all (an upload `PUT` Cloud Storage answered
    /// with a `4xx` before `CompleteMediaUpload` was ever called).
    func recordTerminalFailure(transfer: MediaTransfer, reason: String, serverUploadState: String? = nil) async throws {
        let updatedRetryState = transfer.retryState.recordingAttempt(errorCategory: .validation, at: now())
        let updated = transfer.updating(
            state: .failed,
            retryState: updatedRetryState,
            updatedAt: now(),
            serverUploadState: serverUploadState,
            failureReason: reason
        )
        try await transferStore.save(updated)
        broadcast(updated)
        log.record(.warning, "Media transfer rejected: \(reason).")
    }
}
