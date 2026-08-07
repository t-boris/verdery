import CoreDomain
import Foundation
import Observation

/// A single in-progress photo attachment's presentation state — the object
/// `FeaturePlants.PlantDetailViewModel`/`FeatureObservations
/// .ObservationsTimelineViewModel` each hold one of directly, so neither
/// feature re-implements upload progress/retry/subscription plumbing on top
/// of `MediaUploadCoordinator` independently.
///
/// `@MainActor`/`@Observable`, matching every feature view model in this
/// codebase (`PlantDetailViewModel`, `ObservationsTimelineViewModel`, …):
/// `status` drives SwiftUI directly.
///
/// Source: implementation-plan.md work package P6-IOS-01.
@MainActor
@Observable
public final class PhotoAttachmentController {
    public private(set) var status: PhotoAttachmentStatus = .idle
    public private(set) var transferId: String?

    /// Where the camera says this photograph was taken, read out of its EXIF
    /// before that metadata was removed for upload.
    ///
    /// Kept because a phone standing next to a plant already knows which bed
    /// it is in — far better than asking someone to pick one from a list of
    /// every object in the garden. Deliberately coarse evidence, never an
    /// answer: consumer GPS resolves a bed, not a plant.
    public private(set) var capturedLatitude: Double?
    public private(set) var capturedLongitude: Double?

    private let coordinator: MediaUploadCoordinator
    private let gardenId: String
    private let profileId: String
    private let mediaClass: MediaClass
    private var observationTask: Task<Void, Never>?

    public init(coordinator: MediaUploadCoordinator, gardenId: String, profileId: String, mediaClass: MediaClass) {
        self.coordinator = coordinator
        self.gardenId = gardenId
        self.profileId = profileId
        self.mediaClass = mediaClass
    }

    /// The server-assigned media id, once `status == .ready` — what a
    /// caller passes to `AttachPlantPhoto`/`RecordObservation`'s
    /// `photoMediaIds`. `nil` at every other status.
    public var mediaId: String? {
        if case let .ready(mediaId) = status { return mediaId }
        return nil
    }

    /// Starts a brand-new attachment: durably persists `data` and kicks off
    /// registration/upload in the background — see `MediaUploadCoordinator
    /// .enqueue`'s own doc comment for the durability guarantee this call
    /// inherits. Replaces whatever attachment (if any) this controller was
    /// previously tracking; the caller is responsible for calling
    /// `discard()` first if the prior one should be removed rather than
    /// merely forgotten by this controller.
    /// Prepares the photograph before anything durable happens to it: the
    /// coordinate is read out and stripped, and an oversized capture is
    /// reduced. Both have to precede persistence, or the file on disk — and
    /// then the file uploaded — is the wrong one. See ``PhotoPreparation``.
    public func attach(data: Data, displayFilename: String, contentType: String) async {
        observationTask?.cancel()

        let prepared = PhotoPreparation.prepare(data, contentType: contentType)
        capturedLatitude = prepared.capturedLatitude
        capturedLongitude = prepared.capturedLongitude

        do {
            let transfer = try await coordinator.enqueue(
                data: prepared.data,
                gardenId: gardenId,
                profileId: profileId,
                mediaClass: mediaClass,
                displayFilename: displayFilename,
                contentType: contentType
            )
            transferId = transfer.id
            status = PhotoAttachmentStatus.from(transfer)
            observe(transferId: transfer.id)
        } catch {
            status = .failed(reasonCode: "media.localDurabilityFailed")
        }
    }

    /// Explicit, user-initiated retry — see `MediaUploadCoordinator.retry`'s
    /// own doc comment for how this differs from automatic retry. A no-op
    /// when nothing is attached, or the current status is not
    /// `isRetryable`.
    public func retry() async {
        guard let transferId, status.isRetryable else { return }
        await coordinator.retry(transferId: transferId)
    }

    /// Deliberate discard — removes the durable local file and row, and
    /// resets this controller back to `.idle`.
    public func discard() async {
        observationTask?.cancel()
        observationTask = nil

        if let transferId {
            await coordinator.discard(transferId: transferId)
        }
        transferId = nil
        status = .idle
    }

    /// A one-shot `GetMediaStatus`-backed re-check — the manual fallback for
    /// the one case `MediaUploadCoordinator`'s own automatic processing poll
    /// does not reach: a transfer that was already `.retained` before this
    /// screen session began (see `MediaUploadCoordinator
    /// .recoverInFlightTransfers`'s own doc comment on this exact gap).
    public func refreshStatus() async {
        guard let transferId, let transfer = try? await coordinator.currentTransfer(id: transferId) else { return }
        status = PhotoAttachmentStatus.from(transfer)
    }

    /// Subscribes to every update this transfer's row receives.
    ///
    /// `[weak self]` is re-resolved INSIDE the loop body, on every value,
    /// rather than once before it: binding `self` once via `guard let self`
    /// ahead of a `for await` loop would keep a strong reference alive for
    /// the loop's entire lifetime (including while suspended between
    /// values), which — since this task is itself stored on `self` as
    /// `observationTask` — would be a genuine self-retain cycle preventing
    /// this controller from ever deallocating. Re-checking per iteration
    /// means the controller can still deallocate normally once its owner
    /// (a feature view model) releases it; the one accepted, documented
    /// trade-off is that the now-orphaned task itself stays suspended,
    /// awaiting a value from a transfer few will ever query again, until
    /// either one more event arrives (after which it exits immediately,
    /// `self` being `nil`) or the process ends — a bounded, minor leak of
    /// one suspended coroutine, not of the controller or anything it owns.
    private func observe(transferId: String) {
        let coordinator = self.coordinator
        observationTask = Task { [weak self] in
            let stream = await coordinator.updates(for: transferId)
            for await transfer in stream {
                guard let self else { return }
                self.status = PhotoAttachmentStatus.from(transfer)
            }
        }
    }
}
