import Foundation

/// The real, background-capable `BackgroundUploadTransport`: a
/// `URLSessionConfiguration.background(withIdentifier:)` session, uploading
/// each transfer's local file directly via `uploadTask(with:fromFile:)`.
///
/// This is what makes the upload genuinely background-capable, per
/// P6-IOS-01's own title: a background-configured session's transfers are
/// handed to a separate OS daemon (`nsurlsessiond`) that continues them
/// independently of this process — surviving the app being suspended, and,
/// with `sessionSendsLaunchEvents = true`, surviving the app being
/// terminated too. The OS relaunches the app in the background and calls its
/// `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
/// once a session identified by the same identifier has events ready; a
/// fresh `URLSession(configuration:delegate:delegateQueue:)` constructed
/// with that identifier automatically reconnects to whatever tasks are still
/// running or have already finished, which is what makes
/// `recoverInFlightTasks` meaningful rather than a fiction.
///
/// A background configuration only supports upload/download tasks created
/// from a file (never an in-memory body, never a custom stream) — which is
/// exactly what this codebase's own local-file-durability requirement
/// already guarantees exists for every transfer before this transport is
/// ever asked to upload it.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; implementation-plan.md work package P6-IOS-01.
public actor URLSessionBackgroundUploadTransport: BackgroundUploadTransport {
    /// Not actor-isolated: read by the composition root/app delegate to
    /// compare against the identifier the OS reports when waking the app,
    /// with no `await` needed for what is a fixed, immutable configuration
    /// value.
    public nonisolated let sessionIdentifier: String

    private let session: URLSession
    private let delegate: BackgroundUploadSessionDelegate
    private let eventContinuation: AsyncStream<BackgroundUploadEvent>.Continuation
    public let events: AsyncStream<BackgroundUploadEvent>

    private var transferIdByTaskIdentifier: [Int: String] = [:]

    public init(sessionIdentifier: String) {
        self.sessionIdentifier = sessionIdentifier

        let delegate = BackgroundUploadSessionDelegate()
        self.delegate = delegate

        var continuation: AsyncStream<BackgroundUploadEvent>.Continuation!
        self.events = AsyncStream { continuation = $0 }
        self.eventContinuation = continuation

        let configuration = URLSessionConfiguration.background(withIdentifier: sessionIdentifier)
        // The user explicitly initiated this transfer (attaching a photo
        // right now) — start promptly rather than waiting for the OS's own
        // notion of an optimal moment, unlike a truly opportunistic
        // background sync.
        configuration.isDiscretionary = false
        // Required for the OS to relaunch the app in the background and
        // call `application(_:handleEventsForBackgroundURLSession:
        // completionHandler:)` once this session's tasks finish while the
        // app is suspended or not running — the specific behavior that
        // makes this "background-capable" rather than merely "runs while
        // foregrounded."
        configuration.sessionSendsLaunchEvents = true
        configuration.allowsCellularAccess = true
        configuration.waitsForConnectivity = true

        self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)

        delegate.eventSink = { [weak self] taskIdentifier, rawEvent in
            Task { await self?.handleRawEvent(taskIdentifier: taskIdentifier, rawEvent) }
        }
    }

    public func startUpload(transferId: String, request: URLRequest, fileURL: URL) async {
        let task = session.uploadTask(with: request, fromFile: fileURL)
        transferIdByTaskIdentifier[task.taskIdentifier] = transferId
        task.resume()
    }

    public func recoverInFlightTasks(matchingUploadUrlsByTransferId uploadUrlsByTransferId: [String: URL]) async -> Set<String> {
        let tasks = await allTasks()
        var recovered: Set<String> = []

        for task in tasks {
            guard
                let requestUrl = task.originalRequest?.url,
                let match = uploadUrlsByTransferId.first(where: { $0.value == requestUrl })
            else { continue }

            transferIdByTaskIdentifier[task.taskIdentifier] = match.key
            recovered.insert(match.key)
        }

        return recovered
    }

    public func handleBackgroundSessionEvents(completionHandler: @escaping @Sendable () -> Void) async {
        delegate.backgroundEventsFinishedSink = { completionHandler() }
    }

    private func handleRawEvent(taskIdentifier: Int, _ rawEvent: BackgroundUploadSessionDelegate.RawEvent) async {
        guard let transferId = transferIdByTaskIdentifier[taskIdentifier] else { return }

        switch rawEvent {
        case let .progress(bytesSent, totalBytes):
            eventContinuation.yield(.progress(transferId: transferId, bytesSent: bytesSent, totalBytes: totalBytes))

        case let .finished(statusCode, rangeHeader, urlErrorCode):
            transferIdByTaskIdentifier[taskIdentifier] = nil
            eventContinuation.yield(
                .finished(
                    transferId: transferId,
                    statusCode: statusCode,
                    rangeHeader: rangeHeader,
                    transportFailureCode: urlErrorCode
                )
            )
        }
    }

    private func allTasks() async -> [URLSessionTask] {
        await withCheckedContinuation { continuation in
            session.getAllTasks { tasks in continuation.resume(returning: tasks) }
        }
    }
}
