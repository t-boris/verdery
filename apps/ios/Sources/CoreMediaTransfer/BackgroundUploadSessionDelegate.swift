import Foundation

/// Bridges `URLSessionTaskDelegate`'s synchronous, OS-thread-dispatched
/// callbacks into `URLSessionBackgroundUploadTransport`, an actor.
///
/// A plain `NSObject` subclass, not an actor: `URLSessionDelegate` inherits
/// `NSObjectProtocol`, which an `actor` cannot conform to directly (an
/// actor's own methods are implicitly isolated/async-callable, incompatible
/// with the Objective-C runtime's synchronous dispatch into a delegate).
/// `@unchecked Sendable` is safe here because every delegate method below
/// only reads its own parameters and calls one `Sendable` closure —
/// `URLSession` itself already serializes every callback onto one private
/// delegate queue (`delegateQueue: nil` at construction), so there is no
/// concurrent mutation of anything this object owns to race on.
final class BackgroundUploadSessionDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    enum RawEvent {
        case progress(bytesSent: Int64, totalBytes: Int64)
        case finished(statusCode: Int?, rangeHeader: String?, urlErrorCode: URLError.Code?)
    }

    /// Set once by `URLSessionBackgroundUploadTransport.init`, forwarding
    /// every raw event into the actor by task identifier — the actor is the
    /// only thing that knows which transfer id a task identifier belongs to
    /// (see that type's own doc comment).
    var eventSink: (@Sendable (_ taskIdentifier: Int, _ event: RawEvent) -> Void)?
    /// Set by `handleBackgroundSessionEvents(completionHandler:)` each time
    /// the app delegate hands one over; cleared by the transport once
    /// invoked.
    var backgroundEventsFinishedSink: (@Sendable () -> Void)?

    func urlSession(
        _: URLSession,
        task: URLSessionTask,
        didSendBodyData _: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        eventSink?(task.taskIdentifier, .progress(bytesSent: totalBytesSent, totalBytes: totalBytesExpectedToSend))
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let response = task.response as? HTTPURLResponse
        eventSink?(
            task.taskIdentifier,
            .finished(
                statusCode: response?.statusCode,
                rangeHeader: response?.value(forHTTPHeaderField: "Range"),
                urlErrorCode: (error as? URLError)?.code
            )
        )
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession _: URLSession) {
        backgroundEventsFinishedSink?()
    }
}
