import Foundation
import GRDB

/// Opens (creating if needed) the per-profile local database file, and owns
/// its `DatabaseMigrator`.
///
/// Relocated here from `FeatureGardens.GardenDatabase` (Phase 2): this is now
/// the `Core/Persistence` module the architecture names in
/// architecture/ios-application-design.md, section "4. Application
/// Structure", and section "21. Dependency Rules" keeps GRDB itself out of
/// every layer above this one ("GRDB ... types remain inside adapters or
/// feature infrastructure") — `CorePersistence` is that adapter for the
/// database's lifecycle and schema. `FeatureGardens` still uses GRDB
/// directly for its own read-model repository (`GRDBGardenStore`), the same
/// way `CoreNetworking`'s adapters use `URLSession` directly; this type only
/// centralizes *opening and migrating* the one database file every profile's
/// local tables share.
///
/// ## Migration numbering
///
/// `"createGarden"` is byte-for-byte the migration `GardenDatabase` already
/// shipped in Phase 2 — moving house does not change a migration's identity,
/// and `DatabaseMigrator` tracks applied migrations by name, not by which
/// Swift file registered them. Every migration after it is new in this work
/// package (P5-IOS-01). `MigrationIntegrityTests` proves a database created
/// at the old (`"createGarden"`-only) schema still opens and migrates
/// forward without data loss.
///
/// ## Profile scoping
///
/// Scoped by Firebase UID, available immediately after sign-in without a
/// server round trip — not the application profile ID, which this client
/// never fetches directly (see architecture/identity-and-authorization.md,
/// section "6. Application Profile Provisioning": provisioning is a side
/// effect of the first authenticated request, not a response this client
/// reads). architecture/ios-application-design.md, section "7. Local
/// Persistence" says "one application-owned SQLite database per signed-in
/// profile"; Firebase UID is what this client can name a per-profile
/// database by *without* a network call, which this work package's own scope
/// prohibits adding. Scoping by Firebase UID still delivers what
/// "per-profile" is for: switching accounts on one device does not mix
/// their local data. See this work package's report for why no new
/// identifier type was introduced to paper over that gap — the honest
/// call was to carry the Phase 2 reasoning forward unchanged, not rename
/// around it.
public enum LocalDatabase {
    public static func open(profileIdentifier: String) throws -> DatabaseQueue {
        let directory = try applicationSupportDirectory().appendingPathComponent(
            "profiles/\(profileIdentifier)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let dbQueue = try DatabaseQueue(path: directory.appendingPathComponent("gardens.sqlite").path)
        try migrator.migrate(dbQueue)
        return dbQueue
    }

    private static func applicationSupportDirectory() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
    }

    /// `internal`, not `private`: `MigrationIntegrityTests` runs the
    /// pre-P5-IOS-01 subset of this migrator directly, against a database
    /// file it creates itself, to prove forward migration from a real prior
    /// schema — see that test file's doc comment for why a hand-written
    /// migrator subset, not this one, plays the role of "representative
    /// prior schema".
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        // Phase 2 (FeatureGardens.GardenDatabase); local read model example
        // for architecture/offline-synchronization.md, section "5. Local
        // Tables" ("local domain read models").
        migrator.registerMigration("createGarden") { db in
            try db.create(table: "garden") { table in
                table.column("id", .text).primaryKey()
                table.column("name", .text).notNull()
                table.column("lifecycleState", .text).notNull()
                table.column("callerRole", .text).notNull()
                table.column("revision", .integer).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
        }

        registerSynchronizationMigrations(on: &migrator)
        registerMapObjectMigration(on: &migrator)
        registerPlantMigration(on: &migrator)

        return migrator
    }
}
