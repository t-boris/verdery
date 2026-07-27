import CoreDomain
import CoreNetworking
import Foundation

@testable import FeatureGardens

/// In-memory, non-networked stand-in for `GardenContextGateway` — mirrors
/// `FeatureRecommendationsTests/FakeRecommendationGateway`'s exact shape
/// (in-memory, `@unchecked Sendable`, a `nextFailure` knob, recorded call
/// state).
final class FakeGardenContextGateway: GardenContextGateway, @unchecked Sendable {
    struct RecordCall: Equatable {
        let gardenId: String
        let contextKind: GardenContextKind
        let value: String
        let source: GardenContextSource
        let reviewedBy: String?
        let reviewedOn: String?
    }

    private(set) var factsByKind: [GardenContextKind: GardenContextFact]
    /// When set, the next call throws this once instead of answering.
    var nextFailure: APIGatewayError?

    private(set) var listCalls: [String] = []
    private(set) var recordCalls: [RecordCall] = []
    private var nextRevision = 1

    init(facts: [GardenContextFact] = []) {
        self.factsByKind = Dictionary(uniqueKeysWithValues: facts.map { ($0.contextKind, $0) })
    }

    func listGardenContextFacts(gardenId: String) async throws -> GardenContextFactListResult {
        if let failure = nextFailure {
            nextFailure = nil
            throw failure
        }
        listCalls.append(gardenId)
        return GardenContextFactListResult(items: Array(factsByKind.values).sorted { $0.contextKind.rawValue < $1.contextKind.rawValue })
    }

    func recordGardenContextFact(
        gardenId: String,
        contextKind: GardenContextKind,
        value: String,
        source: GardenContextSource,
        reviewedBy: String?,
        reviewedOn: String?
    ) async throws -> GardenContextFact {
        if let failure = nextFailure {
            nextFailure = nil
            throw failure
        }
        recordCalls.append(
            RecordCall(
                gardenId: gardenId,
                contextKind: contextKind,
                value: value,
                source: source,
                reviewedBy: reviewedBy,
                reviewedOn: reviewedOn
            )
        )

        let existing = factsByKind[contextKind]
        let fact = GardenContextFact(
            id: existing?.id ?? "fact-\(contextKind.rawValue)",
            gardenId: gardenId,
            contextKind: contextKind,
            value: value,
            source: source,
            reviewedBy: reviewedBy,
            reviewedOn: reviewedOn,
            recordedByProfileId: "profile-1",
            recordedAt: Date(timeIntervalSince1970: 1_785_800_000),
            revision: nextRevision,
            createdAt: existing?.createdAt ?? Date(timeIntervalSince1970: 1_785_800_000),
            updatedAt: Date(timeIntervalSince1970: 1_785_800_000)
        )
        nextRevision += 1
        factsByKind[contextKind] = fact
        return fact
    }

    static func serviceError(statusCode: Int, code: String) -> APIGatewayError {
        .service(
            APIErrorBody(code: code, message: code, correlationId: "fake", retryable: false),
            statusCode: statusCode,
            retryAfterSeconds: nil
        )
    }
}
