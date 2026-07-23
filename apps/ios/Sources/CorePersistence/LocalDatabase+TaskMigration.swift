import GRDB

/// The `task` local read-model table — P5-IOS-02 (Stage 4e)'s counterpart to
/// `LocalDatabase+PlantMigration.swift`'s `"createPlant"` migration.
///
/// Split into its own file for the same reason that one is: a thematically
/// distinct, feature-owned local read model, not the shared sync-protocol
/// tables `LocalDatabase+SynchronizationMigrations.swift` registers.
///
/// `FeatureTasks.GRDBTaskStore` reads and writes this table directly against
/// GRDB, the same way `FeatureGardens.GRDBGardenStore` does for `garden`,
/// `FeatureMap.GRDBMapStore` does for `garden_object`, and
/// `FeaturePlants.GRDBPlantStore` does for `plant` — see those types' own
/// doc comments, and `LocalDatabase.swift`'s, for why schema is centralized
/// here while the record/repository type lives in the owning feature.
///
/// Every column mirrors `CoreDomain.GardenTask` field for field — the same
/// "full field set, not a narrower projection" reasoning `PlantRecord`'s own
/// doc comment gives: every offline command except `CreateManualTask` (whose
/// `current` is always `nil`) must return a complete, correct `GardenTask`
/// the view model renders directly, with no network re-fetch to patch over a
/// gap.
///
/// Unlike `plant`/`garden` (one row per record, read one at a time) but like
/// `garden_object` (N rows per garden, read as a whole list per screen), this
/// table is indexed by `gardenId` for `GRDBTaskStore.fetchAll(gardenId:)`/
/// `replaceAll(gardenId:with:)` — `TasksListViewModel` renders one garden's
/// whole task list, not a single task, the same shape `MapEditorViewModel`
/// renders `garden_object` through.
///
/// Source: architecture/offline-synchronization.md, section "5. Local
/// Tables"; implementation-plan.md work package P5-IOS-02.
extension LocalDatabase {
    static func registerTaskMigration(on migrator: inout DatabaseMigrator) {
        migrator.registerMigration("createTask") { db in
            try db.create(table: "task") { table in
                table.column("id", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("targetKind", .text).notNull()
                table.column("targetGardenAreaMapObjectId", .text)
                table.column("targetPlantId", .text)
                table.column("title", .text).notNull()
                table.column("notes", .text)
                table.column("status", .text).notNull()
                table.column("dueDate", .text)
                table.column("timeWindowStart", .datetime)
                table.column("timeWindowEnd", .datetime)
                table.column("recurrenceRule", .text)
                table.column("urgency", .text).notNull()
                table.column("source", .text).notNull()
                table.column("originObservationId", .text)
                table.column("revision", .integer).notNull()
                table.column("createdByProfileId", .text).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
                table.column("completedAt", .datetime)
            }
            try db.create(index: "task_on_gardenId", on: "task", columns: ["gardenId"])
        }
    }
}
