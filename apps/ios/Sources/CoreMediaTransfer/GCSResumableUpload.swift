import Foundation

/// Pure request-building and response-parsing for Cloud Storage's real
/// resumable-upload wire protocol — deliberately factored out of
/// `MediaUploadCoordinator`/`URLSessionBackgroundUploadTransport` so it is
/// testable with no `URLSession`, no delegate, and no background transfer at
/// all.
///
/// `RegisterMediaUpload`'s `uploadUrl` (`services/api/src/modules/media/
/// persistence/gcs-media-storage-gateway.ts`, `file.createResumableUpload`)
/// is a genuine Cloud Storage resumable session URI, not a plain upload
/// endpoint — the client is expected to speak this protocol directly
/// (architecture/media-storage-and-processing.md, section "2. Principles":
/// "Binary media bypasses the interactive API data path"). Two client
/// behaviors this type implements:
///
/// 1. **A single `PUT` covering the whole declared byte range** — the normal
///    path for one attempt: `Content-Range: bytes 0-<size-1>/<size>` sent
///    once, body = the whole file. Cloud Storage finalizes the object on
///    receiving a `Content-Range` whose upper bound reaches `total - 1`.
/// 2. **A zero-byte status-check `PUT`** (`Content-Range: bytes */<size>`)
///    after an interruption, whose response tells the client exactly how
///    many bytes Cloud Storage actually has — `200`/`201` (already
///    complete), `308` with a `Range: bytes=0-<lastByteReceived>` response
///    header (partially received, resume from `lastByteReceived + 1`), or
///    anything else (the session is gone: expired, never started, or
///    invalid — the caller must register a fresh one).
///
/// Source: https://cloud.google.com/storage/docs/performing-resumable-uploads
/// (the real Cloud Storage resumable-upload wire protocol this type
/// implements a client for); architecture/media-storage-and-processing.md,
/// section "7. Upload Flow"; implementation-plan.md work package P6-IOS-01.
public enum GCSResumableUpload {
    /// Builds the `PUT` request for uploading `range` of `totalBytes` —
    /// `range == 0..<totalBytes` for the normal single-shot whole-object
    /// case, or a later byte range when resuming a partially-received
    /// object. The caller supplies the request body separately (a
    /// background `URLSessionUploadTask` reads it from a file, never from
    /// this request's own `httpBody`).
    public static func uploadRequest(uploadUrl: URL, range: Range<Int64>, totalBytes: Int64) -> URLRequest {
        var request = URLRequest(url: uploadUrl)
        request.httpMethod = "PUT"
        request.setValue(
            "bytes \(range.lowerBound)-\(range.upperBound - 1)/\(totalBytes)",
            forHTTPHeaderField: "Content-Range"
        )
        request.setValue(String(range.upperBound - range.lowerBound), forHTTPHeaderField: "Content-Length")
        return request
    }

    /// Builds the empty-body status-check `PUT` used to learn how many bytes
    /// Cloud Storage already has after an interruption, before resuming.
    public static func statusCheckRequest(uploadUrl: URL, totalBytes: Int64) -> URLRequest {
        var request = URLRequest(url: uploadUrl)
        request.httpMethod = "PUT"
        request.setValue("bytes */\(totalBytes)", forHTTPHeaderField: "Content-Range")
        request.setValue("0", forHTTPHeaderField: "Content-Length")
        return request
    }

    public enum StatusCheckOutcome: Equatable, Sendable {
        /// The object is fully received and finalized — proceed straight to
        /// `CompleteMediaUpload`, no further bytes need sending.
        case complete
        /// Cloud Storage has `receivedBytes` of the object so far — resume
        /// by sending the remaining range, `receivedBytes..<totalBytes`.
        case incomplete(receivedBytes: Int64)
        /// The session is gone (expired, never started, or an id Cloud
        /// Storage does not recognize) — the caller must abandon it and
        /// register a fresh one.
        case sessionInvalid
    }

    /// Parses a status-check response's status code and `Range` response
    /// header (Cloud Storage's own format: `bytes=0-<lastByteReceived>`,
    /// absent entirely when zero bytes have been received yet).
    public static func parseStatusCheckResponse(statusCode: Int, rangeHeader: String?) -> StatusCheckOutcome {
        switch statusCode {
        case 200, 201:
            return .complete
        case 308:
            guard let rangeHeader, let receivedBytes = receivedByteCount(fromRangeHeader: rangeHeader) else {
                // A `308` with no `Range` header means zero bytes received
                // so far — a valid, resumable-from-the-start outcome, not a
                // parse failure.
                return .incomplete(receivedBytes: 0)
            }
            return .incomplete(receivedBytes: receivedBytes)
        default:
            return .sessionInvalid
        }
    }

    /// `"bytes=0-524287"` → `524288` (the COUNT of bytes already received —
    /// one past the last received byte's own index).
    private static func receivedByteCount(fromRangeHeader header: String) -> Int64? {
        guard let dashIndex = header.lastIndex(of: "-") else { return nil }
        let upperBoundText = header[header.index(after: dashIndex)...]
        guard let upperBound = Int64(upperBoundText) else { return nil }
        return upperBound + 1
    }
}
