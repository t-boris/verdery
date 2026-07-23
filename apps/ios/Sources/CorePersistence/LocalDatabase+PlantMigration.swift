import GRDB

/// The `plant` local read-model table — P5-IOS-02 (Stage 4c)'s counterpart to
/// `LocalDatabase+MapObjectMigration.swift`'s `"createGardenObject"` migration.
///
/// Split into its own file for the same reason that one is: a thematically
/// distinct, feature-owned local read model, not the shared sync-protocol
/// tables `LocalDatabase+SynchronizationMigrations.swift` registers.
///
/// `FeaturePlants.GRDBPlantStore` reads and writes this table directly
/// against GRDB, the same way `FeatureGardens.GRDBGardenStore` does for
/// `garden` and `FeatureMap.GRDBMapStore` does for `garden_object` — see
/// those types' own doc comments, and `LocalDatabase.swift`'s, for why schema
/// is centralized here while the record/repository type lives in the owning
/// feature.
///
/// Every column mirrors `CoreDomain.Plant` field for field — unlike
/// `garden_object`'s `geometry`/`categoryDetails` JSON columns, a plant has
/// no nested/polymorphic fields, so a normalized column per field is the
/// simpler, equally sufficient choice here. See `PlantRecord`'s own doc
/// comment for why the local row needs the plant's full field set, not a
/// narrower projection, even though `FeaturePlants`'s read screens
/// (`PlantDetailViewModel`) stay always-fresh-from-server for display.
///
/// Source: architecture/offline-synchronization.md, section "5. Local
/// Tables" ("local domain read models"); implementation-plan.md work package
/// P5-IOS-02.
extension LocalDatabase {
    static func registerPlantMigration(on migrator: inout DatabaseMigrator) {
        migrator.registerMigration("createPlant") { db in
            try db.create(table: "plant") { table in
                table.column("id", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("gardenAreaMapObjectId", .text)
                table.column("placementMapObjectId", .text)
                table.column("displayName", .text).notNull()
                table.column("taxonomyReferenceId", .text)
                table.column("varietyLabel", .text)
                table.column("acceptedIdentificationId", .text)
                table.column("acquisitionDate", .text)
                table.column("acquisitionDateType", .text)
                table.column("groupingKind", .text).notNull()
                table.column("quantity", .integer)
                table.column("lifecycleStage", .text).notNull()
                table.column("status", .text).notNull()
                table.column("conditionNote", .text)
                table.column("careGuidanceNote", .text)
                table.column("revision", .integer).notNull()
                table.column("createdByProfileId", .text).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
            try db.create(index: "plant_on_gardenId", on: "plant", columns: ["gardenId"])
        }
    }
}
