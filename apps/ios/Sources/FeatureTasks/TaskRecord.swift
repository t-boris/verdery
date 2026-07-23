import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local task read model (`task`).
///
/// Every column mirrors `CoreDomain.GardenTask` field for field — see
/// `CorePersistence.LocalDatabase+TaskMigration.swift`'s own doc comment for
/// why the full field set, not a narrower projection, is what this table
/// needs: `EditTask`/`RescheduleTask` change only a handful of fields while
/// everything else must still come out of the projection exactly as it was,
/// the same reasoning `FeaturePlants.PlantRecord`'s own doc comment gives.
struct TaskRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "task"

    let id: String
    let gardenId: String
    let targetKind: String
    let targetGardenAreaMapObjectId: String?
    let targetPlantId: String?
    let title: String
    let notes: String?
    let status: String
    let dueDate: String?
    let timeWindowStart: Date?
    let timeWindowEnd: Date?
    let recurrenceRule: String?
    let urgency: String
    let source: String
    let originObservationId: String?
    let revision: Int
    let createdByProfileId: String
    let createdAt: Date
    let updatedAt: Date
    let completedAt: Date?
}

extension TaskRecord {
    init(_ task: GardenTask) {
        self.id = task.id
        self.gardenId = task.gardenId
        self.targetKind = task.targetKind.rawValue
        self.targetGardenAreaMapObjectId = task.targetGardenAreaMapObjectId
        self.targetPlantId = task.targetPlantId
        self.title = task.title
        self.notes = task.notes
        self.status = task.status.rawValue
        self.dueDate = task.dueDate
        self.timeWindowStart = task.timeWindowStart
        self.timeWindowEnd = task.timeWindowEnd
        self.recurrenceRule = task.recurrenceRule
        self.urgency = task.urgency.rawValue
        self.source = task.source.rawValue
        self.originObservationId = task.originObservationId
        self.revision = task.revision
        self.createdByProfileId = task.createdByProfileId
        self.createdAt = task.createdAt
        self.updatedAt = task.updatedAt
        self.completedAt = task.completedAt
    }

    /// `nil` when any stored column cannot be decoded back into its domain
    /// type — the same defensive-read posture `PlantRecord.domainValue`/
    /// `GardenRecord.domainValue` already establish, so a caller's
    /// `compactMap` drops a corrupt row rather than failing the whole read.
    var domainValue: GardenTask? {
        guard
            let targetKind = TaskTargetKind(rawValue: targetKind),
            let status = TaskStatus(rawValue: status),
            let urgency = TaskUrgency(rawValue: urgency),
            let source = TaskSource(rawValue: source)
        else {
            return nil
        }

        return GardenTask(
            id: id,
            gardenId: gardenId,
            targetKind: targetKind,
            targetGardenAreaMapObjectId: targetGardenAreaMapObjectId,
            targetPlantId: targetPlantId,
            title: title,
            notes: notes,
            status: status,
            dueDate: dueDate,
            timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd,
            recurrenceRule: recurrenceRule,
            urgency: urgency,
            source: source,
            originObservationId: originObservationId,
            revision: revision,
            createdByProfileId: createdByProfileId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            completedAt: completedAt
        )
    }
}
