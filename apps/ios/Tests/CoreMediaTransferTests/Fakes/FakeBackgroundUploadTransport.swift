import Foundation

@testable import CoreMediaTransfer

/// A `BackgroundUploadTransport` test double: records every
/// `startUpload` call and lets a test inject events as if the OS delivered
/// them, with no real `URLSession` or network involved.
actor FakeBackgroundUploadTransport: BackgroundUploadTransport {
    struct StartUploadCall: Equatable {
        let transferId: String
        let url: URL
        let contentRange: String?
        let fileURL: URL
    }

    private(set) var startUploadCalls: [StartUploadCall] = []
    private let continuation: AsyncStream<BackgroundUploadEvent>.Continuation
    let events: AsyncStream<BackgroundUploadEvent>

    /// What `recoverInFlightTasks` returns — set by a test before
    /// constructing/`start()`-ing the coordinator under test, to simulate
    /// the OS having kept (or lost) a task across a simulated relaunch.
    var transferIdsStillInFlight: Set<String> = []

    init() {
        var continuation: AsyncStream<BackgroundUploadEvent>.Continuation!
        self.events = AsyncStream { continuation = $0 }
        self.continuation = continuation
    }

    func startUpload(transferId: String, request: URLRequest, fileURL: URL) async {
        startUploadCalls.append(
            StartUploadCall(
                transferId: transferId,
                url: request.url!,
                contentRange: request.value(forHTTPHeaderField: "Content-Range"),
                fileURL: fileURL
            )
        )
    }

    func recoverInFlightTasks(matchingUploadUrlsByTransferId _: [String: URL]) async -> Set<String> {
        transferIdsStillInFlight
    }

    func setTransferIdsStillInFlight(_ transferIds: Set<String>) {
        transferIdsStillInFlight = transferIds
    }

    func handleBackgroundSessionEvents(completionHandler: @escaping @Sendable () -> Void) async {
        completionHandler()
    }

    /// Test-only: injects an event as if the OS delivered it through the
    /// real background session delegate.
    func emit(_ event: BackgroundUploadEvent) {
        continuation.yield(event)
    }
}
