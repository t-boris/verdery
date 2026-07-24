import Foundation

/// One event `BackgroundUploadTransport` reports for a transfer it is
/// carrying — either a progress tick, or a terminal outcome (Cloud Storage
/// answered, or the transport itself failed before an answer arrived).
public enum BackgroundUploadEvent: Sendable, Equatable {
    case progress(transferId: String, bytesSent: Int64, totalBytes: Int64)
    /// `statusCode`/`rangeHeader` are Cloud Storage's own response, present
    /// together whenever a real HTTP response arrived (even a rejecting
    /// one); `transportFailureCode` is set instead when the request never
    /// completed at the transport level at all (no connectivity, task
    /// cancelled, background transfer daemon gave up) — mutually exclusive
    /// with the other two, matching `CoreNetworking.HTTPTransport`'s own
    /// "a response arrived" versus "connectivity failed before an answer
    /// arrived" distinction (`APIGatewayError.service` versus `.transport`).
    case finished(transferId: String, statusCode: Int?, rangeHeader: String?, transportFailureCode: URLError.Code?)
}

/// A background-capable byte-transport for one Cloud Storage resumable
/// upload session — the seam `MediaUploadCoordinator` depends on instead of
/// `URLSession` directly, so its own state-machine logic is testable with no
/// real network and no real background transfer at all.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; implementation-plan.md work package P6-IOS-01.
public protocol BackgroundUploadTransport: Sendable {
    /// Starts (or restarts, after a prior task for this transfer was lost)
    /// uploading `fileURL`'s bytes to `request.url` with `request`'s own
    /// method/headers — `MediaUploadCoordinator` has already built the
    /// correct `Content-Range`/`Content-Length` via `GCSResumableUpload`.
    /// Returns once the task exists and has started; the outcome arrives
    /// asynchronously through `events`.
    func startUpload(transferId: String, request: URLRequest, fileURL: URL) async

    /// Every progress/completion event this transport produces, for every
    /// transfer it is tracking — one shared stream, subscribed once by
    /// `MediaUploadCoordinator.start()`.
    var events: AsyncStream<BackgroundUploadEvent> { get async }

    /// Reconnects to whatever tasks the OS kept alive across a relaunch,
    /// matching each one back to a transfer id by its request URL (the same
    /// `uploadUrl` `MediaTransferStore` already persisted) — real background
    /// transfers survive app suspension AND termination; this is how a fresh
    /// process picks their results back up instead of starting a duplicate
    /// upload. Returns the transfer ids actually found still in flight.
    func recoverInFlightTasks(matchingUploadUrlsByTransferId uploadUrlsByTransferId: [String: URL]) async -> Set<String>

    /// Forwards the app delegate's own
    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
    /// completion handler — Apple's documented contract for a background
    /// session that finished delivering its queued events while the app was
    /// suspended or not running: the OS wakes the app, the app must call
    /// this handler once every event has actually been processed, or the OS
    /// may suspend the app again before delivery completes.
    func handleBackgroundSessionEvents(completionHandler: @escaping @Sendable () -> Void) async
}
