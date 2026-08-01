import Foundation

/// The record of one candidate's conversion into a real plant —
/// `ConvertCandidate`'s own append-only receipt.
///
/// Source: packages/api-contracts/openapi.yaml, `CandidateConversion`.
public struct CandidateConversion: Equatable, Sendable, Identifiable {
    public let id: String
    public let candidateId: String
    public let plantId: String
    public let convertedByProfileId: String
    public let convertedAt: Date

    public init(
        id: String,
        candidateId: String,
        plantId: String,
        convertedByProfileId: String,
        convertedAt: Date
    ) {
        self.id = id
        self.candidateId = candidateId
        self.plantId = plantId
        self.convertedByProfileId = convertedByProfileId
        self.convertedAt = convertedAt
    }
}

/// `ConvertCandidate`'s response: the newly created plant, the now-`converted`
/// candidate, and the conversion receipt linking them.
///
/// Source: packages/api-contracts/openapi.yaml, `ConvertCandidateResult`.
public struct ConvertCandidateResult: Equatable, Sendable {
    public let plant: Plant
    public let candidate: PlantCandidate
    public let conversion: CandidateConversion

    public init(plant: Plant, candidate: PlantCandidate, conversion: CandidateConversion) {
        self.plant = plant
        self.candidate = candidate
        self.conversion = conversion
    }
}
