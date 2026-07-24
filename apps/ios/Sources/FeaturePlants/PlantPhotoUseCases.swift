import CoreDomain
import CoreNetworking
import Foundation

/// Attaches an already-uploaded photo to a plant — P6-IOS-01's own "garden
/// photo attachment" wiring, the gap `PlantsUseCases.swift`'s own doc
/// comment on `AttachPlantPhoto` previously described as fully implemented
/// and tested at the gateway layer but reachable from no real UI flow
/// ("this codebase has no file-upload flow yet to produce a `mediaId`").
/// `CoreMediaTransfer.MediaUploadCoordinator` is that flow now — see
/// `PlantDetailViewModel.attachPickedPhoto`'s own doc comment for the full
/// pick → durably-persist → upload → verify → attach sequence this use case
/// is the LAST step of.
///
/// Online only, never routed through the offline outbox: mirrors
/// `packages/api-contracts/openapi.yaml`'s own description of
/// `AttachPlantPhoto` — "Appends a photo. Never changes the plant's own
/// revision — a photo is a child record" — and, more fundamentally, this
/// call only ever has a real `mediaId` to attach once
/// `MediaUploadCoordinator` has already confirmed the upload durable
/// server-side (`PhotoAttachmentStatus.ready`), which itself required
/// connectivity to reach — an offline-queued attach command referencing a
/// `mediaId` from a purely local, unconfirmed upload would defer to a
/// dependency this codebase's outbox has no mechanism for yet (see
/// `MediaUploadCoordinator`'s own report on this documented gap).
public struct AttachPlantPhoto: Sendable {
    private let gateway: any PlantGateway
    private let generateIdempotencyKey: @Sendable () -> String

    public init(gateway: any PlantGateway, generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate) {
        self.gateway = gateway
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    public func callAsFunction(gardenId: String, plantId: String, mediaId: String, isPrimary: Bool? = nil) async throws -> PlantPhoto {
        try await gateway.attachPlantPhoto(
            gardenId: gardenId,
            plantId: plantId,
            mediaId: mediaId,
            isPrimary: isPrimary,
            idempotencyKey: generateIdempotencyKey()
        )
    }
}
