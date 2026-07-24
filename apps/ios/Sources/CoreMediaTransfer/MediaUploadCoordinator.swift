import CoreDomain
import CoreNetworking
import CoreObservability
import CorePersistence
import CoreSynchronization
import CryptoKit
import Foundation

/// The background-capable media registration/upload/verify coordinator —
/// P6-IOS-01's own centerpiece.
///
/// Drives one `CoreDomain.MediaTransfer` row through
/// `captured → registered → queued → uploading → verifying → retained`
/// (architecture/ios-application-design.md, section "13. Media Transfer"),
/// with a `failed`/`recoverable` branch reachable from `uploading` or
/// `verifying`, by:
///
/// 1. Writing the file durably (`LocalMediaFileStore`) and persisting a
///    `MediaTransfer` row (`MediaTransferStore`) BEFORE any network call —
///    `enqueue`'s own guarantee.
/// 2. Calling `MediaGateway.registerMediaUpload` to obtain a Cloud Storage
///    resumable-upload session (`MediaUploadCoordinator+Registration.swift`).
/// 3. `PUT`-ing the file's bytes to that session directly, over a real
///    background `URLSession` (`BackgroundUploadTransport`, never through
///    `MediaGateway`/the interactive API), with real byte-progress and real
///    interruption/resume handling
///    (`MediaUploadCoordinator+Upload.swift`).
/// 4. Calling `MediaGateway.completeMediaUpload`, then polling
///    `getMediaStatus` for `processingState`
///    (`MediaUploadCoordinator+Complete.swift`).
/// 5. Recovering an in-flight or interrupted transfer after app relaunch —
///    from durable `MediaTransferStore` rows plus the OS's own still-alive
///    background tasks (`MediaUploadCoordinator+Recovery.swift`).
///
/// Retry-category gating reuses `CoreSynchronization`'s own established
/// policy directly (`SyncErrorCategory.isEligibleForAutomaticRetry`,
/// `SyncBackoff`) rather than re-deriving it — see this target's own
/// `Package.swift` comment for why that Core-on-Core dependency is
/// reasonable, and those two symbols' own doc comments for why they are
/// `public` as of this stage.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; architecture/media-storage-and-processing.md, sections
/// "6. Upload State Machine", "7. Upload Flow"; architecture/offline-
/// synchronization.md, section "18. Media Coordination"; implementation-
/// plan.md work package P6-IOS-01.
public actor MediaUploadCoordinator {
    let fileStore: any LocalMediaFileStore
    let transferStore: any MediaTransferStore
    let gateway: any MediaGateway
    let uploadTransport: any BackgroundUploadTransport
    /// A small, ordinary (non-background) `URLSession` for the tiny,
    /// synchronous-style Cloud Storage status-check `PUT`
    /// (`GCSResumableUpload.statusCheckRequest`) issued when resuming an
    /// interrupted upload — deliberately NOT routed through
    /// `uploadTransport`: a background configuration only supports file-
    /// based upload/download tasks with delegate-callback results, which
    /// fits the large binary transfer, not a request this coordinator wants
    /// to `await` a response from directly.
    let statusCheckSession: URLSession
    let now: @Sendable () -> Date
    let generateId: @Sendable () -> String
    let randomUnitInterval: @Sendable () -> Double
    let log: any DiagnosticLog

    /// Bounded automatic status-poll attempts after a successful
    /// `CompleteMediaUpload`, waiting for `processingState` to leave
    /// `.processing` — see `MediaUploadCoordinator+Complete.swift`'s own doc
    /// comment for why this is bounded rather than unbounded, and injectable
    /// for deterministic tests.
    let maxProcessingPollAttempts: Int
    let sleep: @Sendable (TimeInterval) async -> Void

    var observersByTransferId: [String: [UUID: AsyncStream<MediaTransfer>.Continuation]] = [:]
    var hasStarted = false

    public init(
        fileStore: any LocalMediaFileStore,
        transferStore: any MediaTransferStore,
        gateway: any MediaGateway,
        uploadTransport: any BackgroundUploadTransport,
        statusCheckSession: URLSession = .shared,
        now: @escaping @Sendable () -> Date = Date.init,
        generateId: @escaping @Sendable () -> String = UUIDv7.generate,
        randomUnitInterval: @escaping @Sendable () -> Double = { Double.random(in: 0..<1) },
        maxProcessingPollAttempts: Int = 6,
        sleep: @escaping @Sendable (TimeInterval) async -> Void = { seconds in
            try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
        },
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.fileStore = fileStore
        self.transferStore = transferStore
        self.gateway = gateway
        self.uploadTransport = uploadTransport
        self.statusCheckSession = statusCheckSession
        self.now = now
        self.generateId = generateId
        self.randomUnitInterval = randomUnitInterval
        self.maxProcessingPollAttempts = maxProcessingPollAttempts
        self.sleep = sleep
        self.log = log
    }

    /// Begins consuming `uploadTransport.events` for the lifetime of this
    /// instance and recovers whatever transfers were left mid-flight by a
    /// prior process — called exactly once, by the composition root, right
    /// after construction. Safe to call more than once (a defensive guard,
    /// not a documented repeat-call contract): a second call is a no-op.
    public func start() async {
        guard !hasStarted else { return }
        hasStarted = true

        Task { [weak self] in
            guard let self else { return }
            for await event in await self.uploadTransport.events {
                await self.handle(event)
            }
        }

        await recoverInFlightTransfers()
    }

    /// Local durability, then a durable row — architecture/media-storage-
    /// and-processing.md, section "2. Principles": "The only local copy is
    /// never deleted before verified remote durability or deliberate user
    /// discard" presupposes a durable local copy exists at all, which is
    /// exactly what this method guarantees before it returns: by the time
    /// the caller has a `MediaTransfer` back, both the file
    /// (`LocalMediaFileStore.write`) and the row (`MediaTransferStore.save`)
    /// are durably on disk. Neither the caller nor process termination
    /// between this call and a successful upload can lose the photo.
    ///
    /// Registration/upload are kicked off in the background (fire-and-
    /// forget, matching `RootScene.triggerSyncOnForeground`'s identical
    /// "no UI to block on this" posture) — a caller observes progress
    /// through `updates(for:)`, not by awaiting the whole pipeline here.
    public func enqueue(
        data: Data,
        gardenId: String,
        profileId: String,
        mediaClass: MediaClass,
        displayFilename: String,
        contentType: String
    ) async throws -> MediaTransfer {
        let localId = generateId()
        let fileURL: URL
        do {
            fileURL = try fileStore.write(
                data,
                localId: localId,
                profileId: profileId,
                fileExtension: Self.fileExtension(forContentType: contentType)
            )
        } catch {
            throw MediaUploadError.fileWriteFailed
        }

        let timestamp = now()
        let transfer = MediaTransfer(
            id: localId,
            gardenId: gardenId,
            localFileUrl: fileURL.absoluteString,
            checksum: Self.checksumHex(for: data),
            byteCount: Int64(data.count),
            state: .captured,
            createdAt: timestamp,
            updatedAt: timestamp,
            mediaClass: mediaClass,
            displayFilename: displayFilename,
            declaredContentType: contentType,
            declaredByteSize: Int64(data.count)
        )
        try await transferStore.save(transfer)
        broadcast(transfer)

        Task { [weak self] in await self?.driveUpload(transferId: localId, bypassingAutomaticRetryGate: false) }

        return transfer
    }

    /// Explicit, user-initiated retry — bypasses `SyncBackoff`'s automatic
    /// gate exactly the way `RemoteSyncEngine.retryNow()` bypasses it for
    /// sync, per architecture/offline-synchronization.md, section
    /// "20. Connectivity and Backoff": "User-initiated retry can wake
    /// eligible work..." names automatic retry specifically as what is
    /// restricted. A no-op (not an error) for a transfer already `.retained`
    /// or mid-flight — retrying a status that is not `isRetryable`
    /// (`PhotoAttachmentStatus`'s own doc comment) would either duplicate an
    /// upload already in progress or attempt to resubmit bytes the server
    /// has already durably rejected.
    public func retry(transferId: String) async {
        guard
            let transfer = try? await transferStore.fetch(id: transferId),
            PhotoAttachmentStatus.from(transfer).isRetryable,
            transfer.state == .failed || transfer.state == .recoverable
        else { return }

        Task { [weak self] in await self?.driveUpload(transferId: transferId, bypassingAutomaticRetryGate: true) }
    }

    /// Deliberate user discard — architecture/media-storage-and-processing.md,
    /// section "2. Principles": the only condition (besides verified remote
    /// durability) under which the local copy may be removed. Best-effort on
    /// the file (a missing file is not an error to the caller —
    /// `LocalMediaFileStore.delete`'s own doc comment), authoritative on the
    /// row: once this returns, `fetch(id:)` for `transferId` returns `nil`.
    public func discard(transferId: String) async {
        guard let transfer = try? await transferStore.fetch(id: transferId) else { return }

        if let url = URL(string: transfer.localFileUrl) {
            try? fileStore.delete(at: url)
        }

        let discarded = transfer.updating(state: .deleted, retryState: transfer.retryState, updatedAt: now())
        try? await transferStore.save(discarded)
        broadcast(discarded)
    }

    /// The current row, for a caller that wants a one-shot read rather than
    /// subscribing to `updates(for:)`.
    public func currentTransfer(id: String) async throws -> MediaTransfer? {
        try await transferStore.fetch(id: id)
    }

    /// Every update this transfer's row receives from this point forward —
    /// registration, progress ticks, verification, completion, failure.
    /// Multiple independent subscribers are supported (each gets its own
    /// continuation); a subscriber that stops iterating (view disappears,
    /// task cancelled) is cleaned up via `AsyncStream`'s own
    /// `onTermination`, not left leaking in `observersByTransferId` forever.
    public func updates(for transferId: String) -> AsyncStream<MediaTransfer> {
        AsyncStream { continuation in
            let token = UUID()
            observersByTransferId[transferId, default: [:]][token] = continuation

            continuation.onTermination = { @Sendable [weak self] _ in
                Task { await self?.removeObserver(token: token, transferId: transferId) }
            }
        }
    }

    func broadcast(_ transfer: MediaTransfer) {
        for continuation in (observersByTransferId[transfer.id] ?? [:]).values {
            continuation.yield(transfer)
        }
    }

    private func removeObserver(token: UUID, transferId: String) {
        observersByTransferId[transferId]?[token] = nil
    }

    private static func checksumHex(for data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// A small, deliberately non-exhaustive mapping: every content type
    /// `docs/architecture/media-storage-and-processing.md` section "8.1"
    /// accepts for a garden photo, plus PDF for a future imported-plan
    /// caller. Unknown types fall back to `"bin"` rather than throwing —
    /// registration's own `declaredContentType` (sent verbatim to the
    /// server) is what actually matters for validation; the local file
    /// extension is cosmetic.
    static func fileExtension(forContentType contentType: String) -> String {
        switch contentType {
        case "image/jpeg": "jpg"
        case "image/png": "png"
        case "image/webp": "webp"
        case "image/heic": "heic"
        case "image/heif": "heif"
        case "application/pdf": "pdf"
        default: "bin"
        }
    }
}
