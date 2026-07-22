import Foundation
import GRDB

/// Opens (creating if needed) the per-profile local database file.
///
/// Scoped by Firebase UID, available immediately after sign-in without a
/// server round trip — not the application profile ID, which this client
/// never fetches directly (see architecture/identity-and-authorization.md,
/// section "6. Application Profile Provisioning": provisioning is a side
/// effect of the first authenticated request, not a response this client
/// reads). Scoping by Firebase UID still delivers what "per-profile" is for:
/// switching accounts on one device does not mix their local data.
public enum GardenDatabase {
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

    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("createGarden") { db in
            try db.create(table: GardenRecord.databaseTableName) { table in
                table.column("id", .text).primaryKey()
                table.column("name", .text).notNull()
                table.column("lifecycleState", .text).notNull()
                table.column("callerRole", .text).notNull()
                table.column("revision", .integer).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
        }

        return migrator
    }
}
