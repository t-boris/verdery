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
            updatedAt: updatedAt
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
