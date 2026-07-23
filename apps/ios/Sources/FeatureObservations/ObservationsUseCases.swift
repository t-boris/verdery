import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for the observation history operations.
///
/// `photoMediaIds` is always `[]` from every use case here: attaching a
/// photo needs a `mediaId`, and this codebase has no file-upload flow yet to
/// produce one (`media.media_record` only records that a reference exists).
/// `RecordObservation`/`CorrectObservation` still work fully without a photo
/// — the contract only requires *one* of `noteText`, `conditionSummary`, or a
/// photo — so this is an honest reduction in scope, not a broken command.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Observations`.
public struct RecordObservation: Sendable {
    private let gateway: any ObservationGateway

    public init(gateway: any ObservationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String? = nil,
        gardenObjectId: String? = nil,
        noteText: String? = nil,
        conditionSummary: String? = nil,
        observedAt: Date? = nil
    ) async throws -> GardenObservation {
        try await gateway.recordObservation(
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: gardenObjectId,
            noteText: noteText,
            conditionSummary: conditionSummary,
            observedAt: observedAt,
            photoMediaIds: [],
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct ListObservationsForGarden: Sendable {
    private let gateway: any ObservationGateway

    public init(gateway: any ObservationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenObservation] {
        try await gateway.listObservationsForGarden(gardenId: gardenId)
    }
}

public struct ListObservationsForPlant: Sendable {
    private let gateway: any ObservationGateway

    public init(gateway: any ObservationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, plantId: String) async throws -> [GardenObservation] {
        try await gateway.listObservationsForPlant(gardenId: gardenId, plantId: plantId)
    }
}

/// An "amend" or "supersede" action on an existing timeline entry — never an
/// edit of the original, which stays visible and unmodified. See
/// `ObservationsTimelineView`'s doc comment.
public struct CorrectObservation: Sendable {
    private let gateway: any ObservationGateway

    public init(gateway: any ObservationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String? = nil,
        conditionSummary: String? = nil
    ) async throws -> GardenObservation {
        try await gateway.correctObservation(
            observationId: observationId,
            correctionKind: correctionKind,
            noteText: noteText,
            conditionSummary: conditionSummary,
            photoMediaIds: [],
            idempotencyKey: UUIDv7.generate()
        )
    }
}
