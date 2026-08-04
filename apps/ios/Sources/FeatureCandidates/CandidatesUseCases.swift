import CoreDomain
import CoreNetworking
import Foundation

/// The plant-candidate, conversion, and suitability use cases. Every
/// operation here is ONLINE-ONLY, direct-to-gateway — see
/// `CoreNetworking.PlantCandidateGateway`'s own doc comment for why
/// candidates have no local-store/offline-outbox layer to route through.
public struct AddCandidate: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        rationaleNote: String?,
        priority: PlantCandidatePriority?,
        priceAmount: Double?,
        priceCurrency: String?,
        purchaseSource: String?
    ) async throws -> PlantCandidate {
        try await gateway.addCandidate(
            gardenId: gardenId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            groupingKind: groupingKind,
            quantity: quantity,
            rationaleNote: rationaleNote,
            priority: priority,
            priceAmount: priceAmount,
            priceCurrency: priceCurrency,
            purchaseSource: purchaseSource,
            proposedGardenAreaMapObjectId: nil,
            proposedPlacementMapObjectId: nil,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// No local caching: a candidate search result page has nothing meaningful
/// to show offline, the same choice `FeaturePlants.SearchPlants` already
/// makes for the identical problem on a different resource.
public struct ListCandidates: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        query: String? = nil,
        status: [PlantCandidateStatus]? = nil,
        priority: [PlantCandidatePriority]? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> PlantCandidateListPage {
        try await gateway.listCandidates(
            gardenId: gardenId, query: query, status: status, priority: priority,
            identified: nil, cursor: cursor, limit: limit
        )
    }
}

public struct GetCandidate: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, candidateId: String) async throws -> PlantCandidate {
        try await gateway.getCandidate(gardenId: gardenId, candidateId: candidateId)
    }
}

public struct UpdateCandidateDetails: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        candidateId: String,
        displayName: String?,
        taxonomyReferenceId: FieldUpdate<String>,
        varietyLabel: FieldUpdate<String>,
        quantity: FieldUpdate<Int>,
        rationaleNote: FieldUpdate<String>,
        priority: FieldUpdate<PlantCandidatePriority>,
        priceAmount: FieldUpdate<Double>,
        priceCurrency: FieldUpdate<String>,
        purchaseSource: FieldUpdate<String>,
        expectedRevision: Int
    ) async throws -> PlantCandidate {
        try await gateway.updateCandidateDetails(
            gardenId: gardenId, candidateId: candidateId, displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId, varietyLabel: varietyLabel, quantity: quantity,
            rationaleNote: rationaleNote, priority: priority, priceAmount: priceAmount,
            priceCurrency: priceCurrency, purchaseSource: purchaseSource,
            expectedRevision: expectedRevision, idempotencyKey: UUIDv7.generate()
        )
    }
}

/// `status` must never be `.converted` — see
/// `CoreNetworking.SetCandidateStatusRequestTransport`'s own doc comment.
public struct SetCandidateStatus: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        candidateId: String,
        status: PlantCandidateStatus,
        expectedRevision: Int
    ) async throws -> PlantCandidate {
        try await gateway.setCandidateStatus(
            gardenId: gardenId, candidateId: candidateId, status: status,
            expectedRevision: expectedRevision, idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Permanent removal, the counterpart to `SetCandidateStatus`'s `.archived`
/// and `.rejected`. The API refuses a `.converted` candidate — its conversion
/// record is the resulting plant's provenance — so callers must not offer this
/// once a candidate has been converted.
public struct DeleteCandidate: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        candidateId: String,
        expectedRevision: Int
    ) async throws {
        try await gateway.deleteCandidate(
            gardenId: gardenId, candidateId: candidateId,
            expectedRevision: expectedRevision, idempotencyKey: UUIDv7.generate()
        )
    }
}

/// `gardenAreaMapObjectId`/`placementMapObjectId` default to the candidate's
/// own proposed placement when `nil` — the operation's own contract
/// description, not a value this use case needs to resolve itself.
public struct ConvertCandidate: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        candidateId: String,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        expectedRevision: Int
    ) async throws -> ConvertCandidateResult {
        try await gateway.convertCandidate(
            gardenId: gardenId, candidateId: candidateId, gardenAreaMapObjectId: nil,
            placementMapObjectId: nil, acquisitionDate: acquisitionDate,
            acquisitionDateType: acquisitionDateType, expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Translates a `404` (no assessment has ever been computed —
/// `RecalculateCandidateSuitability` is what a caller is expected to call
/// first) into `nil` rather than letting every call site re-derive that
/// same status-code check independently — mirrors
/// `FeaturePlants.FetchPlantIdentification`'s identical "absent means
/// `nil`, not thrown" narrowing for an identically-shaped "pending, or
/// nothing to review" read. Unlike that type, there is no
/// resource-specific error code to also check — `getCandidateSuitability`'s
/// `404` is the contract's plain generic `NotFound` response — so this
/// narrows on status code alone; any OTHER failure still propagates.
public struct GetCandidateSuitability: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, candidateId: String) async throws -> SuitabilityAssessment? {
        do {
            return try await gateway.getCandidateSuitability(gardenId: gardenId, candidateId: candidateId)
        } catch let error as APIGatewayError {
            guard case .service(_, 404, _) = error else { throw error }
            return nil
        }
    }
}

public struct RecalculateCandidateSuitability: Sendable {
    private let gateway: any PlantCandidateGateway

    public init(gateway: any PlantCandidateGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, candidateId: String) async throws -> SuitabilityAssessment {
        try await gateway.recalculateCandidateSuitability(gardenId: gardenId, candidateId: candidateId)
    }
}

/// The candidates feature's OWN read of the taxonomy catalog, for the
/// add/edit form's taxonomy picker. Built directly on `CoreNetworking
/// .PlantGateway` rather than importing `FeaturePlants` — "a feature may
/// depend on Core; Core never names a feature"
/// (architecture/ios-application-design.md, section "21. Dependency
/// Rules") — mirroring `FeaturePlants.SearchTaxonomyReferences` verbatim,
/// since `searchTaxonomyReferences` is a plain garden-scoped catalog read,
/// not a candidate-specific one.
public struct SearchCandidateTaxonomyReferences: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, query: String? = nil, limit: Int? = nil) async throws -> [TaxonomyReference] {
        try await gateway.searchTaxonomyReferences(gardenId: gardenId, query: query, limit: limit)
    }
}

/// Reads one taxon's catalog profile. Online-only, like every catalog read.
public struct GetTaxonProfile: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(taxonomyReferenceId: String) async throws -> TaxonProfile {
        try await gateway.getTaxonProfile(taxonomyReferenceId: taxonomyReferenceId)
    }
}

