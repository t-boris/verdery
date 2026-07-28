import CoreDomain
import CoreNetworking
import Foundation

/// The domain-local error codes `PlantGateway`'s identification calls can
/// raise. Source: plants-inventory/application/plant-errors.ts, `PlantErrorCode`.
enum PlantErrorCode {
    static let identificationNotFound = "plants_inventory.plant.identification_not_found"
}

/// Creates a plant identified from an already-uploaded photo (ADR-0015) —
/// the use case `PlantsUseCases.swift`'s own doc comment previously
/// described as gateway-only: implemented and tested, but reachable from no
/// real UI flow, because nothing produced the `photoMediaId` it needs.
/// `CoreMediaTransfer.MediaUploadCoordinator`/`PhotoAttachmentController` are
/// that flow now, the same pickup `AttachPlantPhoto` (`PlantPhotoUseCases.swift`)
/// already made for the plant-detail photo attachment.
///
/// Online only, never routed through the offline outbox — see
/// `AttachPlantPhoto`'s own doc comment for the shared reasoning: this call
/// only ever has a real `photoMediaId` once the upload it names has already
/// been confirmed durable server-side, which itself required connectivity.
public struct AddPlantFromPhoto: Sendable {
    private let gateway: any PlantGateway
    private let generateIdempotencyKey: @Sendable () -> String

    public init(gateway: any PlantGateway, generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate) {
        self.gateway = gateway
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    public func callAsFunction(
        gardenId: String,
        photoMediaId: String,
        gardenAreaMapObjectId: String? = nil,
        placementMapObjectId: String? = nil
    ) async throws -> Plant {
        try await gateway.addPlantFromPhoto(
            gardenId: gardenId,
            photoMediaId: photoMediaId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            idempotencyKey: generateIdempotencyKey()
        )
    }
}

/// Accepts a photo-identification suggestion, the same "gateway-only, no UI
/// yet" gap `AddPlantFromPhoto` above closed — see `PlantsUseCases.swift`'s
/// doc comment on why this needed an `identificationId` the app had no way
/// to produce until `AddPlantFromPhoto`/`FetchPlantIdentification` existed.
public struct ConfirmPlantIdentification: Sendable {
    private let gateway: any PlantGateway
    private let generateIdempotencyKey: @Sendable () -> String

    public init(gateway: any PlantGateway, generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate) {
        self.gateway = gateway
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String,
        identificationId: String,
        expectedRevision: Int
    ) async throws -> Plant {
        try await gateway.confirmPlantIdentification(
            gardenId: gardenId,
            plantId: plantId,
            identificationId: identificationId,
            expectedRevision: expectedRevision,
            idempotencyKey: generateIdempotencyKey()
        )
    }
}

/// Reads a plant's still-pending photo-identification suggestion, if any.
///
/// Translates the gateway's `plants_inventory.plant.identification_not_found`
/// `404` into `nil` rather than letting every call site re-derive that same
/// status-code-plus-code check independently — mirrors
/// `FeatureGardens.FetchGardenOwnershipTransfer`'s identical "absent means
/// `nil`, not thrown" narrowing for an identically-shaped "pending, or
/// nothing to review" read. Any OTHER failure (transport, a different
/// service code, a contract mismatch) still propagates.
public struct FetchPlantIdentification: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, plantId: String) async throws -> PlantIdentification? {
        do {
            return try await gateway.getPlantIdentification(gardenId: gardenId, plantId: plantId)
        } catch let error as APIGatewayError {
            guard case let .service(body, statusCode, _) = error,
                statusCode == 404, body.code == PlantErrorCode.identificationNotFound
            else {
                throw error
            }
            return nil
        }
    }
}

/// Records an identification's already-computed condition analysis as a real
/// observation — independent of `ConfirmPlantIdentification`, callable
/// before, after, or instead of it on the same suggestion (ADR-0015's own
/// "AddPlantFromPhoto suggests an observation too" extension).
public struct RecordObservationFromIdentification: Sendable {
    private let gateway: any PlantGateway
    private let generateIdempotencyKey: @Sendable () -> String

    public init(gateway: any PlantGateway, generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate) {
        self.gateway = gateway
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    public func callAsFunction(gardenId: String, plantId: String, identificationId: String) async throws -> GardenObservation {
        try await gateway.recordObservationFromIdentification(
            gardenId: gardenId,
            plantId: plantId,
            identificationId: identificationId,
            idempotencyKey: generateIdempotencyKey()
        )
    }
}
