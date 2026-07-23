import GRDB

/// The `observation` local read-model table — P5-IOS-02 (Stage 4d)'s
/// counterpart to `LocalDatabase+PlantMigration.swift`'s `"createPlant"`
/// migration.
///
/// Split into its own file for the same reason that one is: a thematically
/// distinct, feature-owned local read model, not the shared sync-protocol
/// tables `LocalDatabase+SynchronizationMigrations.swift` registers.
///
/// `FeatureObservations.GRDBObservationStore` reads and writes this table
/// directly against GRDB, the same way `FeatureGardens.GRDBGardenStore` does
/// for `garden`, `FeatureMap.GRDBMapStore` does for `garden_object`, and
/// `FeaturePlants.GRDBPlantStore` does for `plant` — see those types' own
/// doc comments, and `LocalDatabase.swift`'s, for why schema is centralized
/// here while the record/repository type lives in the owning feature.
///
/// Unlike every one of those three tables — durable mirrors of a mutable
/// current record, upserted by both an offline command AND a successful
/// online read — this table holds only rows this device appended itself,
/// purely offline: `ObservationsTimelineViewModel` stays always-fresh-from-
/// the-server for `ListObservationsForGarden`/`ListObservationsForPlant`,
/// neither of which ever writes here. A narrower column set than `plant`'s
/// "same as the domain type's full field set" follows from that: every row
/// this table ever holds came from a single, from-scratch insert
/// (`RecordObservation`, `CorrectObservation`), never a partial update that
/// needs an untouched field preserved — see `FeatureObservations
/// .ObservationRecord`'s own doc comment for the column-by-column reasoning.
///
/// Source: architecture/offline-synchronization.md, section "5. Local
/// Tables" ("local domain read models"); implementation-plan.md work package
/// P5-IOS-02.
extension LocalDatabase {
    static func registerObservationMigration(on migrator: inout DatabaseMigrator) {
        migrator.registerMigration("createObservation") { db in
            try db.create(table: "observation") { table in
                table.column("id", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("plantId", .text)
                table.column("gardenObjectId", .text)
                table.column("noteText", .text)
                table.column("conditionSummary", .text)
                table.column("correctionKind", .text)
                table.column("correctsObservationId", .text)
                table.column("observedAt", .datetime).notNull()
                table.column("recordedAt", .datetime).notNull()
            }
            try db.create(index: "observation_on_gardenId", on: "observation", columns: ["gardenId"])
        }
    }
}
