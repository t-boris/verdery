import CoreDomain
import Foundation

/// Wire shapes of the plant operations.
///
/// These types stay internal: the architecture requires generated or
/// transport models to remain behind the application gateway. Every field
/// name matches `packages/api-contracts/openapi.yaml` exactly, so every one
/// of these structs codes by straight synthesis — `Plant`'s own enums
/// (`PlantGroupingKind`, `PlantLifecycleStage`, ...) are directly `Codable`,
/// the same choice `CoreDomain/Map`'s enums already make (unlike
/// `GardenLifecycleState`/`GardenRole`, which stay plain because
/// `GardenRecord` also has to round-trip them through GRDB as raw strings —
/// no such local store exists for plants, so nothing forces that extra
/// indirection here).
///
/// Source: packages/api-contracts/openapi.yaml, tag `Plants`.
struct PlantTransport: Codable {
    let id: String
    let gardenId: String
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let acceptedIdentificationId: String?
    let acquisitionDate: String?
    let acquisitionDateType: PlantAcquisitionDateType?
    let groupingKind: PlantGroupingKind
    let quantity: Int?
    let lifecycleStage: PlantLifecycleStage
    let status: PlantStatus
    let conditionNote: String?
    let careGuidanceNote: String?
    let coverMediaId: String?
    let revision: Int
    let createdByProfileId: String
    let createdAt: Date
    let updatedAt: Date
}

extension PlantTransport {
    var domainValue: Plant {
        Plant(
            id: id,
            gardenId: gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acceptedIdentificationId: acceptedIdentificationId,
            acquisitionDate: acquisitionDate,
            acquisitionDateType: acquisitionDateType,
            groupingKind: groupingKind,
            quantity: quantity,
            lifecycleStage: lifecycleStage,
            status: status,
            conditionNote: conditionNote,
            careGuidanceNote: careGuidanceNote,
            revision: revision,
            createdByProfileId: createdByProfileId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            coverMediaId: coverMediaId
        )
    }
}

struct PlantPhotoTransport: Codable {
    let id: String
    let plantId: String
    let mediaId: String
    let isPrimary: Bool
    let createdAt: Date

    var domainValue: PlantPhoto {
        PlantPhoto(id: id, plantId: plantId, mediaId: mediaId, isPrimary: isPrimary, createdAt: createdAt)
    }
}

struct TaxonomyReferenceTransport: Codable {
    let id: String
    let scientificName: String
    let commonName: String?
    let varietyName: String?
    let source: TaxonomySource
    let createdByProfileId: String?
    let createdAt: Date

    var domainValue: TaxonomyReference {
        TaxonomyReference(
            id: id,
            scientificName: scientificName,
            commonName: commonName,
            varietyName: varietyName,
            source: source,
            createdByProfileId: createdByProfileId,
            createdAt: createdAt
        )
    }
}

struct TaxonomyReferenceListResultTransport: Decodable {
    let items: [TaxonomyReferenceTransport]
}

struct PlantSearchPageTransport: Decodable {
    let items: [PlantTransport]
    let nextCursor: String?
}

struct PlantPhotoListResultTransport: Decodable {
    let items: [PlantPhotoTransport]
}

struct PlantIdentificationSuggestionTransport: Codable {
    let id: String
    let scientificName: String
    let commonName: String?

    var domainValue: PlantIdentificationSuggestion {
        PlantIdentificationSuggestion(id: id, scientificName: scientificName, commonName: commonName)
    }
}

struct PlantIdentificationTransport: Codable {
    let id: String
    let plantId: String
    let plantPhotoId: String
    let confidenceScore: Double
    let createdAt: Date
    let suggestedTaxonomy: PlantIdentificationSuggestionTransport?
    let suggestedCommonName: String?
    let suggestedScientificName: String?
    let suggestedVarietyLabel: String?
    let suggestedLifecycleStage: PlantLifecycleStage?
    let suggestedConditionNote: String?
    let suggestedCareGuidanceNote: String?
    let suggestedAcquisitionDate: String?

    var domainValue: PlantIdentification {
        PlantIdentification(
            id: id,
            plantId: plantId,
            plantPhotoId: plantPhotoId,
            confidenceScore: confidenceScore,
            createdAt: createdAt,
            suggestedTaxonomy: suggestedTaxonomy?.domainValue,
            suggestedCommonName: suggestedCommonName,
            suggestedScientificName: suggestedScientificName,
            suggestedVarietyLabel: suggestedVarietyLabel,
            suggestedLifecycleStage: suggestedLifecycleStage,
            suggestedConditionNote: suggestedConditionNote,
            suggestedCareGuidanceNote: suggestedCareGuidanceNote,
            suggestedAcquisitionDate: suggestedAcquisitionDate
        )
    }
}

/// `lifecycleStage` is omittable rather than required, matching the
/// contract: the server defaults it to `planned`. It is worth sending for a
/// plant already in the ground, because the stage decides which automatic
/// care rules can see the plant at all — the watering check reads actively
/// growing stages and the frost watch reads frost-sensitive ones, and
/// neither list contains `planned`.
struct AddPlantRequestTransport: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let acquisitionDate: String?
    let acquisitionDateType: PlantAcquisitionDateType?
    let groupingKind: PlantGroupingKind
    let quantity: Int?
    let lifecycleStage: PlantLifecycleStage?
}

struct AddPlantFromPhotoRequestTransport: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let photoMediaId: String
}

/// `displayName` stays a plain optional — the contract does not make it
/// nullable, only omittable — while every other field uses ``FieldUpdate``
/// to distinguish "leave unchanged" from "clear," per that type's doc
/// comment.
struct UpdatePlantDetailsRequestTransport: Encodable {
    let displayName: String?
    let taxonomyReferenceId: FieldUpdate<String>
    let varietyLabel: FieldUpdate<String>
    let acquisitionDate: FieldUpdate<String>
    let acquisitionDateType: FieldUpdate<PlantAcquisitionDateType>
    let conditionNote: FieldUpdate<String>
    let careGuidanceNote: FieldUpdate<String>
    let quantity: FieldUpdate<Int>

    private enum CodingKeys: String, CodingKey {
        case displayName, taxonomyReferenceId, varietyLabel, acquisitionDate
        case acquisitionDateType, conditionNote, careGuidanceNote, quantity
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encode(taxonomyReferenceId, forKey: .taxonomyReferenceId)
        try container.encode(varietyLabel, forKey: .varietyLabel)
        try container.encode(acquisitionDate, forKey: .acquisitionDate)
        try container.encode(acquisitionDateType, forKey: .acquisitionDateType)
        try container.encode(conditionNote, forKey: .conditionNote)
        try container.encode(careGuidanceNote, forKey: .careGuidanceNote)
        try container.encode(quantity, forKey: .quantity)
    }
}

struct AttachPlantPhotoRequestTransport: Encodable {
    let mediaId: String
    let isPrimary: Bool?
}

struct TransitionPlantLifecycleStageRequestTransport: Encodable {
    let stage: PlantLifecycleStage
}

struct SetPlantStatusRequestTransport: Encodable {
    let status: PlantStatus
}

struct MovePlantRequestTransport: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
}

/// `PlantTaxonImage` on the wire.
///
/// A malformed or non-absolute `sourceUrl` drops the image rather than
/// failing the whole profile: one unusable URL must not cost a reader the
/// facts they came for.
struct TaxonImageTransport: Decodable {
    let id: String
    let sourceUrl: String
    let license: String
    let attribution: String?
    let organ: String?

    var domainValue: TaxonImage? {
        guard let url = URL(string: sourceUrl), url.scheme == "https" else { return nil }
        return TaxonImage(
            id: id,
            sourceUrl: url,
            license: license,
            attribution: attribution,
            organ: organ
        )
    }
}

struct ResolvedFactTransport: Decodable {
    let factKey: String
    let value: JSONValue
    let unit: String?
    let providerKey: String
    let sourceCitation: String?

    var domainValue: TaxonProfileFact {
        TaxonProfileFact(
            factKey: factKey,
            displayValue: value.displayText,
            unit: unit,
            providerKey: providerKey,
            sourceCitation: sourceCitation
        )
    }
}

struct PlantProfileVersionTransport: Decodable {
    let id: String
    let taxonomyReferenceId: String
    let resolvedFacts: [ResolvedFactTransport]
    let isPartial: Bool
    let createdAt: Date
}

/// `PlantTaxonProfileResult` on the wire: the profile with its permitted imagery.
struct TaxonProfileResultTransport: Decodable {
    let profile: PlantProfileVersionTransport
    let images: [TaxonImageTransport]

    var domainValue: TaxonProfile {
        TaxonProfile(
            id: profile.id,
            taxonomyReferenceId: profile.taxonomyReferenceId,
            facts: profile.resolvedFacts.map(\.domainValue),
            isPartial: profile.isPartial,
            assembledAt: profile.createdAt,
            images: images.compactMap(\.domainValue)
        )
    }
}
