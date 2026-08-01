import CoreDomain
import Foundation

/// Wire shapes of the plant-candidate, conversion, and suitability
/// operations. See `PlantTransport.swift`'s doc comment for why these enums
/// code by straight synthesis, and why these types stay `internal`.
///
/// Source: packages/api-contracts/openapi.yaml, tag `PlantCandidates`.
struct PlantCandidateTransport: Codable {
    let id: String
    let gardenId: String
    let proposedGardenAreaMapObjectId: String?
    let proposedPlacementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let groupingKind: PlantGroupingKind
    let quantity: Int?
    let status: PlantCandidateStatus
    let rationaleNote: String?
    let priority: PlantCandidatePriority?
    let priceAmount: Double?
    let priceCurrency: String?
    let purchaseSource: String?
    let alternativeToCandidateId: String?
    let revision: Int
    let createdByProfileId: String
    let createdAt: Date
    let updatedAt: Date

    var domainValue: PlantCandidate {
        PlantCandidate(
            id: id,
            gardenId: gardenId,
            proposedGardenAreaMapObjectId: proposedGardenAreaMapObjectId,
            proposedPlacementMapObjectId: proposedPlacementMapObjectId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            groupingKind: groupingKind,
            quantity: quantity,
            status: status,
            rationaleNote: rationaleNote,
            priority: priority,
            priceAmount: priceAmount,
            priceCurrency: priceCurrency,
            purchaseSource: purchaseSource,
            alternativeToCandidateId: alternativeToCandidateId,
            revision: revision,
            createdByProfileId: createdByProfileId,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

struct PlantCandidateListResultTransport: Decodable {
    let items: [PlantCandidateTransport]
    let nextCursor: String?
}

struct SuitabilityEvidenceTransport: Codable {
    let factKey: String
    let value: JSONValue
    let sourceCitation: String?

    var domainValue: SuitabilityEvidence {
        SuitabilityEvidence(factKey: factKey, value: value, sourceCitation: sourceCitation)
    }
}

/// One open object per the contract's own shape — see `SuitabilityFinding`'s
/// doc comment for why this mirrors that flat shape rather than a tagged
/// union.
struct SuitabilityFindingTransport: Codable {
    let category: SuitabilityFindingCategory
    let axis: SuitabilityAxis
    let explanation: String?
    let evidence: [SuitabilityEvidenceTransport]?
    let reason: SuitabilityUnknownReason?
    let assumedValue: JSONValue?

    var domainValue: SuitabilityFinding {
        SuitabilityFinding(
            category: category,
            axis: axis,
            explanation: explanation,
            evidence: (evidence ?? []).map(\.domainValue),
            reason: reason,
            assumedValue: assumedValue
        )
    }
}

struct SuitabilityAssessmentTransport: Decodable {
    let candidateId: String
    let findings: [SuitabilityFindingTransport]

    var domainValue: SuitabilityAssessment {
        SuitabilityAssessment(candidateId: candidateId, findings: findings.map(\.domainValue))
    }
}

struct CandidateConversionTransport: Codable {
    let id: String
    let candidateId: String
    let plantId: String
    let convertedByProfileId: String
    let convertedAt: Date

    var domainValue: CandidateConversion {
        CandidateConversion(
            id: id,
            candidateId: candidateId,
            plantId: plantId,
            convertedByProfileId: convertedByProfileId,
            convertedAt: convertedAt
        )
    }
}

struct ConvertCandidateResultTransport: Decodable {
    let plant: PlantTransport
    let candidate: PlantCandidateTransport
    let conversion: CandidateConversionTransport

    var domainValue: ConvertCandidateResult {
        ConvertCandidateResult(
            plant: plant.domainValue,
            candidate: candidate.domainValue,
            conversion: conversion.domainValue
        )
    }
}

struct AddCandidateRequestTransport: Encodable {
    let proposedGardenAreaMapObjectId: String?
    let proposedPlacementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let groupingKind: PlantGroupingKind
    let quantity: Int?
    let rationaleNote: String?
    let priority: PlantCandidatePriority?
    let priceAmount: Double?
    let priceCurrency: String?
    let purchaseSource: String?
}

/// `displayName` stays a plain optional — the contract does not make it
/// nullable, only omittable — while every other field uses ``FieldUpdate``
/// to distinguish "leave unchanged" from "clear," the same convention
/// `UpdatePlantDetailsRequestTransport` documents. `groupingKind` is
/// immutable and excluded, matching the contract.
struct UpdateCandidateDetailsRequestTransport: Encodable {
    let displayName: String?
    let taxonomyReferenceId: FieldUpdate<String>
    let varietyLabel: FieldUpdate<String>
    let quantity: FieldUpdate<Int>
    let rationaleNote: FieldUpdate<String>
    let priority: FieldUpdate<PlantCandidatePriority>
    let priceAmount: FieldUpdate<Double>
    let priceCurrency: FieldUpdate<String>
    let purchaseSource: FieldUpdate<String>

    private enum CodingKeys: String, CodingKey {
        case displayName, taxonomyReferenceId, varietyLabel, quantity
        case rationaleNote, priority, priceAmount, priceCurrency, purchaseSource
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encode(taxonomyReferenceId, forKey: .taxonomyReferenceId)
        try container.encode(varietyLabel, forKey: .varietyLabel)
        try container.encode(quantity, forKey: .quantity)
        try container.encode(rationaleNote, forKey: .rationaleNote)
        try container.encode(priority, forKey: .priority)
        try container.encode(priceAmount, forKey: .priceAmount)
        try container.encode(priceCurrency, forKey: .priceCurrency)
        try container.encode(purchaseSource, forKey: .purchaseSource)
    }
}

/// `status` must never be `.converted` here — reachable only through
/// `ConvertCandidate` — the same exclusion the request schema itself
/// declares.
struct SetCandidateStatusRequestTransport: Encodable {
    let status: PlantCandidateStatus
}

/// `gardenAreaMapObjectId`/`placementMapObjectId` are plain nullable
/// optionals, not ``FieldUpdate``: omitted means "default to the
/// candidate's own proposed placement" (the operation's own contract
/// description), not "leave the candidate's own field unchanged" — this is
/// a one-shot creation input, not a partial update.
struct ConvertCandidateRequestTransport: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let acquisitionDate: String?
    let acquisitionDateType: PlantAcquisitionDateType?
}
