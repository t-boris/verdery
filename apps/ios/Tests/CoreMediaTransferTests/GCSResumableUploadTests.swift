import Foundation
import Testing

@testable import CoreMediaTransfer

@Suite("GCS resumable upload protocol")
struct GCSResumableUploadTests {
    @Test("Builds a whole-object PUT request with the correct Content-Range")
    func buildsWholeObjectRequest() {
        let url = URL(string: "https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_id=abc")!
        let request = GCSResumableUpload.uploadRequest(uploadUrl: url, range: 0..<1024, totalBytes: 1024)

        #expect(request.httpMethod == "PUT")
        #expect(request.value(forHTTPHeaderField: "Content-Range") == "bytes 0-1023/1024")
        #expect(request.value(forHTTPHeaderField: "Content-Length") == "1024")
    }

    @Test("Builds a resume request covering only the remaining bytes")
    func buildsResumeRequest() {
        let url = URL(string: "https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_id=abc")!
        let request = GCSResumableUpload.uploadRequest(uploadUrl: url, range: 512..<1024, totalBytes: 1024)

        #expect(request.value(forHTTPHeaderField: "Content-Range") == "bytes 512-1023/1024")
        #expect(request.value(forHTTPHeaderField: "Content-Length") == "512")
    }

    @Test("Builds a zero-byte status-check request")
    func buildsStatusCheckRequest() {
        let url = URL(string: "https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_id=abc")!
        let request = GCSResumableUpload.statusCheckRequest(uploadUrl: url, totalBytes: 1024)

        #expect(request.httpMethod == "PUT")
        #expect(request.value(forHTTPHeaderField: "Content-Range") == "bytes */1024")
        #expect(request.value(forHTTPHeaderField: "Content-Length") == "0")
    }

    @Test("A 200/201 status-check response means the object is complete")
    func parsesCompleteResponse() {
        #expect(GCSResumableUpload.parseStatusCheckResponse(statusCode: 200, rangeHeader: nil) == .complete)
        #expect(GCSResumableUpload.parseStatusCheckResponse(statusCode: 201, rangeHeader: nil) == .complete)
    }

    @Test("A 308 with a Range header reports the received byte count")
    func parsesIncompleteResponse() {
        let outcome = GCSResumableUpload.parseStatusCheckResponse(statusCode: 308, rangeHeader: "bytes=0-511")

        #expect(outcome == .incomplete(receivedBytes: 512))
    }

    @Test("A 308 with no Range header means zero bytes received so far")
    func parsesIncompleteResponseWithNoRangeHeader() {
        let outcome = GCSResumableUpload.parseStatusCheckResponse(statusCode: 308, rangeHeader: nil)

        #expect(outcome == .incomplete(receivedBytes: 0))
    }

    @Test("Any other status means the session is invalid or expired")
    func parsesSessionInvalidResponse() {
        #expect(GCSResumableUpload.parseStatusCheckResponse(statusCode: 404, rangeHeader: nil) == .sessionInvalid)
        #expect(GCSResumableUpload.parseStatusCheckResponse(statusCode: 410, rangeHeader: nil) == .sessionInvalid)
        #expect(GCSResumableUpload.parseStatusCheckResponse(statusCode: 500, rangeHeader: nil) == .sessionInvalid)
    }
}
