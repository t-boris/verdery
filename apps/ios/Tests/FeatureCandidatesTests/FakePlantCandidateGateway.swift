import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the real API — mirrors
/// `FeaturePlantsTests/FakePlantGateway`'s role and its `expectRevision`
/// helper for `FeatureCandidates`'s own view-model tests.
final class FakePlantCandidateGateway: PlantCandidateGateway, @unchecked Sendable {
    private(set) var candidates: [String: PlantCandidate]
    private var nextId = 1
    var suitability: [String: SuitabilityAssessment] = [:]
    var listCandidatesPages: [String?: PlantCandidateListPage] = [:]
    var listCandidatesQueries: [(
        query: String?, status: [PlantCandidateStatus]?, priority: [PlantCandidatePriority]?, identified: Bool?
    )] = []
    var addCandidateError: Error?
    var recalculateSuitabilityError: Error?
    var getSuitabilityError: Error?
    var listCandidatesError: Error?

    init(candidates: [PlantCandidate] = []) {
        self.candidates = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0) })
    }

    func addCandidate(
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
        purchaseSource: String?,
        proposedGardenAreaMapObjectId: String?,
        proposedPlacementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        if let addCandidateError { throw addCandidateError }

        let candidate = PlantCandidate(
            id: "candidate-\(nextId)", gardenId: gardenId,
            proposedGardenAreaMapObjectId: proposedGardenAreaMapObjectId,
            proposedPlacementMapObjectId: proposedPlacementMapObjectId, displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId, varietyLabel: varietyLabel, groupingKind: groupingKind,
            quantity: quantity, status: .active, rationaleNote: rationaleNote, priority: priority,
            priceAmount: priceAmount, priceCurrency: priceCurrency, purchaseSource: purchaseSource,
            alternativeToCandidateId: nil, revision: 1, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
        nextId += 1
        candidates[candidate.id] = candidate
        return candidate
    }

    func listCandidates(
        gardenId: String,
        query: String?,
        status: [PlantCandidateStatus]?,
        priority: [PlantCandidatePriority]?,
        identified: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> PlantCandidateListPage {
        if let listCandidatesError { throw listCandidatesError }
        listCandidatesQueries.append((query: query, status: status, priority: priority, identified: identified))
        return listCandidatesPages[cursor] ?? PlantCandidateListPage(items: [], nextCursor: nil)
    }

    func getCandidate(gardenId: String, candidateId: String) async throws -> PlantCandidate {
        try expectExists(candidateId)
    }

    func updateCandidateDetails(
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
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        let current = try expectRevision(candidateId, expectedRevision)
        let updated = PlantCandidate(
            id: current.id, gardenId: current.gardenId,
            proposedGardenAreaMapObjectId: current.proposedGardenAreaMapObjectId,
            proposedPlacementMapObjectId: current.proposedPlacementMapObjectId,
            displayName: displayName ?? current.displayName,
            taxonomyReferenceId: resolved(taxonomyReferenceId, current: current.taxonomyReferenceId),
            varietyLabel: resolved(varietyLabel, current: current.varietyLabel),
            groupingKind: current.groupingKind,
            quantity: resolved(quantity, current: current.quantity),
            status: current.status,
            rationaleNote: resolved(rationaleNote, current: current.rationaleNote),
            priority: resolved(priority, current: current.priority),
            priceAmount: resolved(priceAmount, current: current.priceAmount),
            priceCurrency: resolved(priceCurrency, current: current.priceCurrency),
            purchaseSource: resolved(purchaseSource, current: current.purchaseSource),
            alternativeToCandidateId: current.alternativeToCandidateId, revision: current.revision + 1,
            createdByProfileId: current.createdByProfileId, createdAt: current.createdAt,
            updatedAt: Date(timeIntervalSince1970: 1)
        )
        candidates[candidateId] = updated
        return updated
    }

    func setCandidateStatus(
        gardenId: String,
        candidateId: String,
        status: PlantCandidateStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        let current = try expectRevision(candidateId, expectedRevision)
        let updated = withStatus(current, status)
        candidates[candidateId] = updated
        return updated
    }

    func deleteCandidate(
        gardenId: String,
        candidateId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws {
        _ = try expectRevision(candidateId, expectedRevision)
        candidates[candidateId] = nil
    }

    func convertCandidate(
        gardenId: String,
        candidateId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertCandidateResult {
        let current = try expectRevision(candidateId, expectedRevision)
        let converted = withStatus(current, .converted)
        candidates[candidateId] = converted

        let plant = Plant(
            id: "plant-from-\(candidateId)", gardenId: gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId ?? current.proposedGardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId ?? current.proposedPlacementMapObjectId,
            displayName: current.displayName, taxonomyReferenceId: current.taxonomyReferenceId,
            varietyLabel: current.varietyLabel, acceptedIdentificationId: nil,
            acquisitionDate: acquisitionDate, acquisitionDateType: acquisitionDateType,
            groupingKind: current.groupingKind, quantity: current.quantity, lifecycleStage: .planned,
            status: .active, conditionNote: nil, careGuidanceNote: nil, revision: 1,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 2),
            updatedAt: Date(timeIntervalSince1970: 2)
        )
        let conversion = CandidateConversion(
            id: "conversion-\(candidateId)", candidateId: candidateId, plantId: plant.id,
            convertedByProfileId: "profile-1", convertedAt: Date(timeIntervalSince1970: 2)
        )
        return ConvertCandidateResult(plant: plant, candidate: converted, conversion: conversion)
    }

    func getCandidateSuitability(gardenId: String, candidateId: String) async throws -> SuitabilityAssessment {
        if let getSuitabilityError { throw getSuitabilityError }
        guard let assessment = suitability[candidateId] else {
            throw APIGatewayError.service(
                APIErrorBody(code: "not_found", message: "not found", correlationId: "fake", retryable: false),
                statusCode: 404, retryAfterSeconds: nil
            )
        }
        return assessment
    }

    func recalculateCandidateSuitability(gardenId: String, candidateId: String) async throws -> SuitabilityAssessment {
        if let recalculateSuitabilityError { throw recalculateSuitabilityError }
        let assessment = suitability[candidateId] ?? SuitabilityAssessment(candidateId: candidateId, findings: [])
        suitability[candidateId] = assessment
        return assessment
    }

    private func withStatus(_ candidate: PlantCandidate, _ status: PlantCandidateStatus) -> PlantCandidate {
        PlantCandidate(
            id: candidate.id, gardenId: candidate.gardenId,
            proposedGardenAreaMapObjectId: candidate.proposedGardenAreaMapObjectId,
            proposedPlacementMapObjectId: candidate.proposedPlacementMapObjectId,
            displayName: candidate.displayName, taxonomyReferenceId: candidate.taxonomyReferenceId,
            varietyLabel: candidate.varietyLabel, groupingKind: candidate.groupingKind,
            quantity: candidate.quantity, status: status, rationaleNote: candidate.rationaleNote,
            priority: candidate.priority, priceAmount: candidate.priceAmount,
            priceCurrency: candidate.priceCurrency, purchaseSource: candidate.purchaseSource,
            alternativeToCandidateId: candidate.alternativeToCandidateId, revision: candidate.revision + 1,
            createdByProfileId: candidate.createdByProfileId, createdAt: candidate.createdAt,
            updatedAt: Date(timeIntervalSince1970: 1)
        )
    }

    private func resolved<Value>(_ fieldUpdate: FieldUpdate<Value>, current: Value?) -> Value? {
        switch fieldUpdate {
        case .unchanged: current
        case let .set(value): value
        }
    }

    private func expectExists(_ candidateId: String) throws -> PlantCandidate {
        guard let candidate = candidates[candidateId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-missing-candidate")
        }
        return candidate
    }

    private func expectRevision(_ candidateId: String, _ expected: Int) throws -> PlantCandidate {
        let candidate = try expectExists(candidateId)
        guard candidate.revision == expected else {
            throw APIGatewayError.unexpectedStatus(409, correlationId: "fake-conflict")
        }
        return candidate
    }
}
