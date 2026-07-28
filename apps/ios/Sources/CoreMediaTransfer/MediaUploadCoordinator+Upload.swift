import CoreDomain
import CoreSynchronization
import Foundation

extension MediaUploadCoordinator {
    /// Registers (if needed) and starts/resumes the background upload for
    /// one transfer — the entry point `enqueue`, `retry(transferId:)`, and
    /// recovery-on-relaunch all funnel through.
    ///
    /// An AUTOMATIC attempt (the default, `false`) is withheld when the most
    /// recent failure classified as a category `SyncErrorCategory
    /// .isEligibleForAutomaticRetry` excludes (needs explicit user action,
    /// not more waiting) or when `SyncBackoff`'s timing window has not yet
    /// elapsed. An explicit user-initiated retry (`true`) bypasses BOTH
    /// gates — per `SyncBackoff`'s own doc comment, "explicit retry...
    /// always bypasses this gate anyway": a real user tapping a Retry
    /// affordance they can see is never held back by a timer meant only to
    /// throttle silent, automatic re-attempts.
    func driveUpload(transferId: String, bypassingAutomaticRetryGate: Bool) async {
        guard let transfer = try? await transferStore.fetch(id: transferId) else { return }

        if transfer.retryState.attemptCount > 0, !bypassingAutomaticRetryGate {
            if let category = transfer.retryState.lastErrorCategory,
                !category.isEligibleForAutomaticRetry
            {
                return
            }
            guard SyncBackoff.isEligible(
                attemptCount: transfer.retryState.attemptCount,
                lastAttemptedAt: transfer.retryState.lastAttemptedAt,
                now: now(),
                randomUnitInterval: randomUnitInterval
            ) else {
                return
            }
        }

        do {
            if transfer.mediaId == nil {
                _ = try await register(transferId: transferId, forceNewSession: false)
            }
            try await beginOrResumeUpload(transferId: transferId)
        } catch {
            // Already durably recorded by `register`/`beginOrResumeUpload`
            // themselves — nothing further for this fire-and-forget entry
            // point to do with the thrown error.
        }
    }

    /// Starts the background `PUT`, covering the whole declared byte range
    /// in one request — the normal path for one attempt. If the session's
    /// 1-hour TTL (`services/api`'s `MEDIA_UPLOAD_SESSION_TTL_MS`, mirrored
    /// by `MediaUploadSession.uploadUrlExpiresAt`) has already elapsed
    /// before this transfer ever finished uploading, abandons it and
    /// registers a fresh one instead of attempting a `PUT` Cloud Storage
    /// will reject outright.
    func beginOrResumeUpload(transferId: String) async throws {
        guard let transfer = try await transferStore.fetch(id: transferId) else {
            throw MediaUploadError.transferNotFound
        }
        guard
            let uploadUrlString = transfer.uploadUrl,
            let uploadUrl = URL(string: uploadUrlString),
            let expiresAt = transfer.uploadUrlExpiresAt
        else {
            throw MediaUploadError.notRegistered
        }

        guard expiresAt > now() else {
            _ = try await register(transferId: transferId, forceNewSession: true)
            try await beginOrResumeUpload(transferId: transferId)
            return
        }

        guard
            let fileURL = URL(string: transfer.localFileUrl),
            let totalBytes = transfer.byteCount,
            FileManager.default.fileExists(atPath: fileURL.path)
        else {
            try await recordTerminalFailure(transfer: transfer, reason: "media.localFileMissing")
            throw MediaUploadError.localFileMissing
        }

        let uploading = transfer.updating(state: .uploading, retryState: transfer.retryState, updatedAt: now())
        try await transferStore.save(uploading)
        broadcast(uploading)

        let request = GCSResumableUpload.uploadRequest(uploadUrl: uploadUrl, range: 0..<totalBytes, totalBytes: totalBytes)
        await uploadTransport.startUpload(transferId: transferId, request: request, fileURL: fileURL)
    }

    /// Dispatches one `BackgroundUploadTransport` event — the coordinator's
    /// only consumer of `uploadTransport.events`, subscribed once by
    /// `start()`.
    func handle(_ event: BackgroundUploadEvent) async {
        switch event {
        case let .progress(transferId, bytesSent, _):
            await recordProgress(transferId: transferId, bytesSent: bytesSent)

        case let .finished(transferId, statusCode, rangeHeader, transportFailureCode):
            await handleUploadFinished(
                transferId: transferId,
                statusCode: statusCode,
                rangeHeader: rangeHeader,
                transportFailureCode: transportFailureCode
            )
        }
    }

    private func recordProgress(transferId: String, bytesSent: Int64) async {
        guard let transfer = try? await transferStore.fetch(id: transferId), transfer.state == .uploading else { return }

        let updated = transfer.updating(
            state: .uploading,
            retryState: transfer.retryState,
            updatedAt: now(),
            bytesSent: bytesSent
        )
        try? await transferStore.save(updated)
        broadcast(updated)
    }

    /// Cloud Storage's own answer (or the transport's own failure) to the
    /// upload `PUT` — the fan-out point for every real outcome section 20's
    /// testing matrix names: a clean success, a definitively rejecting
    /// status, an expired/invalid session, and a genuinely transient
    /// interruption this device can resume from exactly where Cloud Storage
    /// says it left off.
    private func handleUploadFinished(
        transferId: String,
        statusCode: Int?,
        rangeHeader: String?,
        transportFailureCode: URLError.Code?
    ) async {
        // A resumed slice, if this was a continuation upload, has served its
        // purpose either way — clean it up unconditionally rather than only
        // on the success path, since a permanently-failed attempt has no
        // further use for it either.
        try? fileStore.delete(at: fileStore.temporarySliceURL(localId: transferId))

        guard let transfer = try? await transferStore.fetch(id: transferId) else { return }

        guard transportFailureCode == nil, let statusCode else {
            try? await recordTransportFailure(transfer: transfer)
            return
        }

        switch statusCode {
        case 200, 201:
            await finalizeUploadedBytes(transfer: transfer)

        case 404, 410:
            // Session invalid or expired — abandon it and register + upload fresh.
            do {
                _ = try await register(transferId: transferId, forceNewSession: true)
                try await beginOrResumeUpload(transferId: transferId)
            } catch {
                // Already recorded by `register`/`beginOrResumeUpload`.
            }

        case 400..<500:
            try? await recordTerminalFailure(transfer: transfer, reason: "media.upload.rejected.\(statusCode)")

        default:
            // `308` (Cloud Storage's own "resume incomplete" answer to a
            // request that did not cover the whole object, e.g. a transfer
            // truncated mid-flight) or a `5xx` — attempt an immediate
            // status-check-and-resume rather than only marking
            // `.recoverable` and waiting for the next trigger; a genuinely
            // unavailable service still ends up `.recoverable` once
            // `resumeAfterInterruption` itself fails to reach Cloud Storage.
            await resumeAfterInterruption(transferId: transferId)
        }
    }

    private func finalizeUploadedBytes(transfer: MediaTransfer) async {
        let verified = transfer.updating(
            state: .verifying,
            retryState: RetryState(),
            updatedAt: now(),
            bytesSent: transfer.declaredByteSize
        )
        try? await transferStore.save(verified)
        broadcast(verified)
        await completeUpload(transferId: transfer.id)
    }

    /// The real Cloud Storage resumable-protocol recovery path: a zero-byte
    /// status-check `PUT`, then either finalize (already complete per Cloud
    /// Storage's own accounting), resume the specific remaining byte range,
    /// or abandon an invalid/expired session for a fresh one.
    func resumeAfterInterruption(transferId: String) async {
        guard
            let transfer = try? await transferStore.fetch(id: transferId),
            let uploadUrlString = transfer.uploadUrl,
            let uploadUrl = URL(string: uploadUrlString),
            let totalBytes = transfer.byteCount
        else { return }

        do {
            let (statusCode, rangeHeader) = try await statusCheck(uploadUrl: uploadUrl, totalBytes: totalBytes)
            switch GCSResumableUpload.parseStatusCheckResponse(statusCode: statusCode, rangeHeader: rangeHeader) {
            case .complete:
                await finalizeUploadedBytes(transfer: transfer)

            case let .incomplete(receivedBytes):
                try await resumeRemainingBytes(
                    transfer: transfer,
                    uploadUrl: uploadUrl,
                    receivedBytes: receivedBytes,
                    totalBytes: totalBytes
                )

            case .sessionInvalid:
                _ = try await register(transferId: transferId, forceNewSession: true)
                try await beginOrResumeUpload(transferId: transferId)
            }
        } catch {
            try? await recordTransportFailure(transfer: transfer)
        }
    }

    private func statusCheck(uploadUrl: URL, totalBytes: Int64) async throws -> (statusCode: Int, rangeHeader: String?) {
        let request = GCSResumableUpload.statusCheckRequest(uploadUrl: uploadUrl, totalBytes: totalBytes)
        let (_, response) = try await statusCheckSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw MediaUploadError.statusCheckFailed }
        return (http.statusCode, http.value(forHTTPHeaderField: "Range"))
    }

    private func resumeRemainingBytes(
        transfer: MediaTransfer,
        uploadUrl: URL,
        receivedBytes: Int64,
        totalBytes: Int64
    ) async throws {
        guard receivedBytes < totalBytes else {
            await finalizeUploadedBytes(transfer: transfer)
            return
        }

        guard let sourceURL = URL(string: transfer.localFileUrl), FileManager.default.fileExists(atPath: sourceURL.path) else {
            try await recordTerminalFailure(transfer: transfer, reason: "media.localFileMissing")
            return
        }

        let sliceURL = fileStore.temporarySliceURL(localId: transfer.id)
        do {
            try MediaFileSlicing.writeSlice(of: sourceURL, byteRange: receivedBytes..<totalBytes, to: sliceURL)
        } catch {
            try await recordTerminalFailure(transfer: transfer, reason: "media.localFileMissing")
            return
        }

        let uploading = transfer.updating(
            state: .uploading,
            retryState: transfer.retryState,
            updatedAt: now(),
            bytesSent: receivedBytes
        )
        try await transferStore.save(uploading)
        broadcast(uploading)

        let request = GCSResumableUpload.uploadRequest(uploadUrl: uploadUrl, range: receivedBytes..<totalBytes, totalBytes: totalBytes)
        await uploadTransport.startUpload(transferId: transfer.id, request: request, fileURL: sliceURL)
    }
}
