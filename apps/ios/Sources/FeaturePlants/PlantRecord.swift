import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local plant read model (`plant`).
///
/// `FeaturePlants` had zero local persistence before P5-IOS-02 (Stage 4c) —
/// `PlantDetailViewModel`/`PlantsHomeViewModel` always read `PlantGateway`
/// directly (see that view model's own doc comment for why: an
/// `expectedRevision`-guarded command needs the server's exact revision, and
/// a stale local cache would turn every command into a `409`/`412` coin
/// flip). This table does not undo that choice for reads — `GetPlant`'s
/// online call stays the source of truth a plant detail screen renders from
/// — it exists solely so the five offline-capable commands below have a
/// durable "current record" to load, validate against, and project forward,
/// the same role `FeatureGardens.GardenRecord`/`FeatureMap.GardenObjectRecord`
/// already play for their own features.
///
/// ## Why the full field set, not a narrower projection
///
/// Every offline command except `AddPlant` (which has no `current` to read —
/// see `PlantsUseCases.swift`) must return a complete, correct `Plant`
/// projection: `UpdatePlantDetails` changes a handful of fields while
/// leaving the rest (including ones this table has no other use for, like
/// `careGuidanceNote`) exactly as they were, and `PlantDetailViewModel.apply(_:)`
/// renders whatever `Plant` a command returns directly, with no separate
/// network re-fetch to paper over an incomplete projection. A local row
/// missing any field could not produce a correct projection for the command
/// that does not touch that field, so the minimal *correct* set turns out to
/// be the same as `Plant`'s own full set — mirroring `GardenRecord`'s
/// identical reasoning, not a narrower "just the revision" table.
///
/// `GetPlant`'s online call populates this table (`save(_:)`) after every
/// successful fetch, the same way `FeatureGardens.GetGarden` populates
/// `garden` — the mechanism that gives an existing plant a local row for the
/// four non-create commands to load, without this feature growing a second,
/// cache-warming read path of its own.
///
/// Source: architecture/offline-synchronization.md, section "5. Local
/// Tables"; implementation-plan.md work package P5-IOS-02.
struct PlantRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "plant"

    let id: String
    let gardenId: String
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let acceptedIdentificationId: String?
    let acquisitionDate: String?
    let acquisitionDateType: String?
    let groupingKind: String
    let quantity: Int?
    let lifecycleStage: String
    let status: String
    let conditionNote: String?
    let careGuidanceNote: String?
    let revision: Int
    let createdByProfileId: String
    let createdAt: Date
    let updatedAt: Date
}

extension PlantRecord {
    init(_ plant: Plant) {
        self.id = plant.id
        self.gardenId = plant.gardenId
        self.gardenAreaMapObjectId = plant.gardenAreaMapObjectId
        self.placementMapObjectId = plant.placementMapObjectId
        self.displayName = plant.displayName
        self.taxonomyReferenceId = plant.taxonomyReferenceId
        self.varietyLabel = plant.varietyLabel
        self.acceptedIdentificationId = plant.acceptedIdentificationId
        self.acquisitionDate = plant.acquisitionDate
        self.acquisitionDateType = plant.acquisitionDateType?.rawValue
        self.groupingKind = plant.groupingKind.rawValue
        self.quantity = plant.quantity
        self.lifecycleStage = plant.lifecycleStage.rawValue
        self.status = plant.status.rawValue
        self.conditionNote = plant.conditionNote
        self.careGuidanceNote = plant.careGuidanceNote
        self.revision = plant.revision
        self.createdByProfileId = plant.createdByProfileId
        self.createdAt = plant.createdAt
        self.updatedAt = plant.updatedAt
    }

    /// `nil` when any stored column cannot be decoded back into its domain
    /// type — the same defensive-read posture `GardenRecord.domainValue`/
    /// `GardenObjectRecord.domainValue` already establish, so a caller's
    /// `compactMap`/optional chain drops a corrupt row rather than failing
    /// the whole read.
    var domainValue: Plant? {
        guard
            let groupingKind = PlantGroupingKind(rawValue: groupingKind),
            let lifecycleStage = PlantLifecycleStage(rawValue: lifecycleStage),
            let status = PlantStatus(rawValue: status)
        else {
            return nil
        }

        let resolvedAcquisitionDateType: PlantAcquisitionDateType?
        if let acquisitionDateType {
            guard let decoded = PlantAcquisitionDateType(rawValue: acquisitionDateType) else { return nil }
            resolvedAcquisitionDateType = decoded
        } else {
            resolvedAcquisitionDateType = nil
        }

        return Plant(
            id: id,
            gardenId: gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acceptedIdentificationId: acceptedIdentificationId,
            acquisitionDate: acquisitionDate,
            acquisitionDateType: resolvedAcquisitionDateType,
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
