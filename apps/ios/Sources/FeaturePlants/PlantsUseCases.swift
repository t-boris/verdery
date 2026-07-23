import CoreDomain
import CoreNetworking

/// Use cases for the plant inventory operations this pass gives a UI to.
///
/// `AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`, and
/// `ConfirmPlantIdentification` have no use case here, even though
/// `PlantGateway` implements and tests all four: every one of them needs a
/// `mediaId` this client has no way to produce yet (see
/// `PlantsHomeView`'s doc comment), so a use case with nothing above it that
/// could ever call it would be dead code, not a completed vertical slice.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Plants`.
public struct AddPlant: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        displayName: String,
        taxonomyReferenceId: String? = nil,
        varietyLabel: String? = nil,
        acquisitionDate: String? = nil,
        acquisitionDateType: PlantAcquisitionDateType? = nil,
        groupingKind: PlantGroupingKind,
        quantity: Int? = nil,
        gardenAreaMapObjectId: String? = nil,
        placementMapObjectId: String? = nil
    ) async throws -> Plant {
        try await gateway.addPlant(
            gardenId: gardenId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acquisitionDate: acquisitionDate,
            acquisitionDateType: acquisitionDateType,
            groupingKind: groupingKind,
            quantity: quantity,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct GetPlant: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, plantId: String) async throws -> Plant {
        try await gateway.getPlant(gardenId: gardenId, plantId: plantId)
    }
}

public struct UpdatePlantDetails: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String,
        displayName: String? = nil,
        taxonomyReferenceId: FieldUpdate<String> = .unchanged,
        varietyLabel: FieldUpdate<String> = .unchanged,
        acquisitionDate: FieldUpdate<String> = .unchanged,
        acquisitionDateType: FieldUpdate<PlantAcquisitionDateType> = .unchanged,
        conditionNote: FieldUpdate<String> = .unchanged,
        careGuidanceNote: FieldUpdate<String> = .unchanged,
        quantity: FieldUpdate<Int> = .unchanged,
        expectedRevision: Int
    ) async throws -> Plant {
        try await gateway.updatePlantDetails(
            gardenId: gardenId,
            plantId: plantId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acquisitionDate: acquisitionDate,
            acquisitionDateType: acquisitionDateType,
            conditionNote: conditionNote,
            careGuidanceNote: careGuidanceNote,
            quantity: quantity,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct TransitionPlantLifecycleStage: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String,
        stage: PlantLifecycleStage,
        expectedRevision: Int
    ) async throws -> Plant {
        try await gateway.transitionLifecycleStage(
            gardenId: gardenId,
            plantId: plantId,
            stage: stage,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Also how "delete a plant" works: there is no hard-delete endpoint, so the
/// detail screen's delete action calls this with `.removed`, not a
/// nonexistent `DELETE`.
public struct SetPlantStatus: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String,
        status: PlantStatus,
        expectedRevision: Int
    ) async throws -> Plant {
        try await gateway.setStatus(
            gardenId: gardenId,
            plantId: plantId,
            status: status,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct MovePlant: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        expectedRevision: Int
    ) async throws -> Plant {
        try await gateway.movePlant(
            gardenId: gardenId,
            plantId: plantId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct SearchTaxonomyReferences: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, query: String? = nil, limit: Int? = nil) async throws -> [TaxonomyReference] {
        try await gateway.searchTaxonomyReferences(gardenId: gardenId, query: query, limit: limit)
    }
}
