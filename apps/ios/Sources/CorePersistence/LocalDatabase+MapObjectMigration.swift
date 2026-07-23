import GRDB

/// The `garden_object` local read-model table — P5-IOS-02 (Stage 4b)'s
/// counterpart to `LocalDatabase.swift`'s own `"createGarden"` migration.
///
/// Split into its own file the same way `LocalDatabase+SynchronizationMigrations.swift`
/// is: this is a thematically distinct addition (a feature's local read
/// model, not the shared sync-protocol tables that file registers) with its
/// own reasoning worth keeping separate from `LocalDatabase.swift`'s opening/
/// scoping responsibility.
///
/// `FeatureMap.GRDBMapStore` reads and writes this table directly against
/// GRDB, the same way `FeatureGardens.GRDBGardenStore` already does for
/// `garden` — see that type's own doc comment, and `LocalDatabase.swift`'s,
/// for why schema is centralized here while the record/repository type lives
/// in the owning feature.
///
/// `geometry` and `categoryDetails` are stored as JSON text columns rather
/// than a normalized column per field: `CoreDomain.Geometry` and
/// `CoreDomain.GardenObjectDetails` already have their own `Codable`
/// conformances (`GeometryCoding.swift`, `GardenObjectDetailsCoding.swift`)
/// that round-trip every one of their variant shapes exactly, and this local
/// table is a single-device read model, not a queryable server table — no
/// query in this app ever filters by a geometry coordinate or a detail
/// field, so normalizing either into columns would add schema complexity
/// with no corresponding read benefit.
///
/// Source: architecture/ios-application-design.md, section "11. Garden Map
/// Feature" ("A read-only base document derived from SQLite"); architecture/
/// offline-synchronization.md, section "5. Local Tables" ("local domain read
/// models"); implementation-plan.md work package P5-IOS-02.
extension LocalDatabase {
    static func registerMapObjectMigration(on migrator: inout DatabaseMigrator) {
        migrator.registerMigration("createGardenObject") { db in
            try db.create(table: "garden_object") { table in
                table.column("id", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("category", .text).notNull()
                table.column("geometry", .text).notNull()
                table.column("coordinateSpaceId", .text).notNull()
                table.column("label", .text)
                table.column("categoryDetails", .text)
                table.column("lifecycleState", .text).notNull()
                table.column("revision", .integer).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
            try db.create(index: "garden_object_on_gardenId", on: "garden_object", columns: ["gardenId"])
        }
    }
}
