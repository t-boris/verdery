import CoreDomain
import Foundation
import Testing

@testable import CoreMediaTransfer

@Suite("PhotoAttachmentStatus")
struct PhotoAttachmentStatusTests {
    private func transfer(
        state: MediaTransferState,
        bytesSent: Int64 = 0,
        byteCount: Int64? = 100,
        mediaId: String? = nil,
        retryState: RetryState = RetryState(),
        serverUploadState: String? = nil,
        serverProcessingState: String? = nil,
        failureReason: String? = nil
    ) -> MediaTransfer {
        MediaTransfer(
            id: "t-1",
            gardenId: "garden-1",
            localFileUrl: "file:///tmp/t-1.jpg",
            byteCount: byteCount,
            state: state,
            retryState: retryState,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0),
            mediaClass: .gardenPhoto,
            displayFilename: "t-1.jpg",
            declaredContentType: "image/jpeg",
            declaredByteSize: 100,
            mediaId: mediaId,
            bytesSent: bytesSent,
            serverUploadState: serverUploadState,
            serverProcessingState: serverProcessingState,
            failureReason: failureReason
        )
    }

    @Test("captured maps to preparing")
    func capturedMapsToPreparing() {
        #expect(PhotoAttachmentStatus.from(transfer(state: .captured)) == .preparing)
    }

    @Test("a captured/queued row with a connectivity failure maps to waitingForConnectivity")
    func connectivityFailureMapsToWaiting() {
        let retryState = RetryState(attemptCount: 1, lastAttemptedAt: Date(), lastErrorCategory: .connectivity)
        #expect(PhotoAttachmentStatus.from(transfer(state: .queued, retryState: retryState)) == .waitingForConnectivity)
    }

    @Test("uploading maps to a progress fraction between 0 and 1")
    func uploadingMapsToProgress() {
        let status = PhotoAttachmentStatus.from(transfer(state: .uploading, bytesSent: 50, byteCount: 100))
        #expect(status == .uploading(progressFraction: 0.5))
    }

    @Test("uploading progress is clamped to 1 even if bytesSent exceeds byteCount")
    func uploadingProgressIsClamped() {
        let status = PhotoAttachmentStatus.from(transfer(state: .uploading, bytesSent: 150, byteCount: 100))
        #expect(status == .uploading(progressFraction: 1))
    }

    @Test("verifying maps to verifying")
    func verifyingMapsToVerifying() {
        #expect(PhotoAttachmentStatus.from(transfer(state: .verifying)) == .verifying)
    }

    @Test("retained with processingState processing maps to processing")
    func retainedProcessingMapsToProcessing() {
        let status = PhotoAttachmentStatus.from(
            transfer(state: .retained, mediaId: "media-1", serverProcessingState: "processing")
        )
        #expect(status == .processing)
    }

    @Test("retained with no processing (or processed) maps to ready")
    func retainedReadyMapsToReady() {
        #expect(
            PhotoAttachmentStatus.from(transfer(state: .retained, mediaId: "media-1")) == .ready(mediaId: "media-1")
        )
        #expect(
            PhotoAttachmentStatus.from(
                transfer(state: .retained, mediaId: "media-1", serverProcessingState: "processed")
            ) == .ready(mediaId: "media-1")
        )
    }

    @Test("failed with serverUploadState rejected maps to rejected, and is not retryable")
    func failedRejectedMapsToRejected() {
        let status = PhotoAttachmentStatus.from(
            transfer(state: .failed, serverUploadState: "rejected", failureReason: "media.upload.rejected")
        )
        #expect(status == .rejected(reasonCode: "media.upload.rejected"))
        #expect(!status.isRetryable)
    }

    @Test("failed with no rejection maps to failed, and IS retryable")
    func failedMapsToFailed() {
        let status = PhotoAttachmentStatus.from(transfer(state: .failed, failureReason: "authorization"))
        #expect(status == .failed(reasonCode: "authorization"))
        #expect(status.isRetryable)
    }

    @Test("recoverable maps to failed (retryable) or waitingForConnectivity depending on the last error category")
    func recoverableMapsAccordingToCategory() {
        let connectivityRetry = RetryState(attemptCount: 1, lastAttemptedAt: Date(), lastErrorCategory: .connectivity)
        #expect(PhotoAttachmentStatus.from(transfer(state: .recoverable, retryState: connectivityRetry)) == .waitingForConnectivity)

        let serverRetry = RetryState(attemptCount: 1, lastAttemptedAt: Date(), lastErrorCategory: .server)
        #expect(
            PhotoAttachmentStatus.from(transfer(state: .recoverable, retryState: serverRetry, failureReason: "server"))
                == .failed(reasonCode: "server")
        )
    }

    @Test("deleted maps to idle")
    func deletedMapsToIdle() {
        #expect(PhotoAttachmentStatus.from(transfer(state: .deleted)) == .idle)
    }
}
