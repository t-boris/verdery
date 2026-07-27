import CoreDomain
import Foundation

/// Wire shapes of the garden context facts operations (P9D-UX-01). See
/// `PlantTransport.swift`'s doc comment for why the enums code by straight
/// synthesis.
///
/// Source: packages/api-contracts/openapi.yaml, tag `GardenContext`.
struct GardenContextFactTransport: Decodable {
    let id: String
    let gardenId: String
    let contextKind: GardenContextKind
    let value: String
    let source: GardenContextSource
    let reviewedBy: String?
    let reviewedOn: String?
    let recordedByProfileId: String
    let recordedAt: Date
    let revision: Int
    let createdAt: Date
    let updatedAt: Date

    var domainValue: GardenContextFact {
        GardenContextFact(
            id: id,
            gardenId: gardenId,
            contextKind: contextKind,
            value: value,
            source: source,
            reviewedBy: reviewedBy,
            reviewedOn: reviewedOn,
            recordedByProfileId: recordedByProfileId,
            recordedAt: recordedAt,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

struct GardenContextFactListResultTransport: Decodable {
    let items: [GardenContextFactTransport]

    var domainValue: GardenContextFactListResult {
        GardenContextFactListResult(items: items.map(\.domainValue))
    }
}

/// `reviewedBy`/`reviewedOn` are absent-when-nil, matching the contract's
/// own independently-optional (not `null`-typed) members — the same
/// `encodeIfPresent` shape `PostponeRecommendationRequestTransport` uses for
/// `postponedUntil`.
struct RecordGardenContextFactRequestTransport: Encodable {
    let value: String
    let source: GardenContextSource
    let reviewedBy: String?
    let reviewedOn: String?

    private enum CodingKeys: String, CodingKey {
        case value
        case source
        case reviewedBy
        case reviewedOn
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(value, forKey: .value)
        try container.encode(source, forKey: .source)
        try container.encodeIfPresent(reviewedBy, forKey: .reviewedBy)
        try container.encodeIfPresent(reviewedOn, forKey: .reviewedOn)
    }
}
