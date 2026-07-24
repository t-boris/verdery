import Foundation

/// Failures `MediaUploadCoordinator` can throw that are not already a
/// `CoreNetworking.APIGatewayError` — every one of these is a local/protocol
/// defect the caller cannot fix by waiting and retrying, so none of them is
/// routed through `CoreDomain.RetryState`/`SyncErrorCategory` the way a
/// gateway or transport failure is.
public enum MediaUploadError: Error, Equatable, Sendable {
    /// `MediaTransferStore` has no row for the id a caller supplied — either
    /// a defect in the caller, or the row was deleted (a discarded photo)
    /// out from under an in-flight operation.
    case transferNotFound
    /// `startUpload`/a resume attempt was called before registration ever
    /// produced a `mediaId`/`uploadUrl`.
    case notRegistered
    /// The durable local file this transfer's row points to is gone —
    /// deleted out from under the coordinator, or never written. Distinct
    /// from a transient read failure: this is a permanent, non-retryable
    /// condition for this transfer (there is nothing left to upload), and
    /// the row is marked `.failed`, not `.recoverable`.
    case localFileMissing
    /// `LocalMediaFileStore.write` failed — the durability step itself could
    /// not complete, so `MediaUploadCoordinator.enqueue` never produces a
    /// row at all rather than persisting a row that lies about having a
    /// file behind it.
    case fileWriteFailed
    /// The Cloud Storage status-check `PUT` (`GCSResumableUpload
    /// .statusCheckRequest`) did not return a real HTTP response at all —
    /// a transport-level failure at that specific step, distinct from
    /// `CoreNetworking.APIGatewayError` because this request never goes
    /// through `HTTPTransport`.
    case statusCheckFailed
}
