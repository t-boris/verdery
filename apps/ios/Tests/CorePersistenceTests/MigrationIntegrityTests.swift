import Foundation
import GRDB
import Testing

@testable import CorePersistence

/// Proves `LocalDatabase.migrator` is safe against a real prior installed
/// schema, not just a fresh one.
///
/// Source: architecture/ios-application-design.md, section "7. Local
/// Persistence" ("Database migrations are explicit, ordered, reversible
/// where practical, and tested against representative prior schemas.
/// Destructive fallback migration is prohibited for user-created data.");
/// section "19. Testing" ("GRDB migration and transaction tests").
@Suite("Migration integrity")
struct MigrationIntegrityTests {
    private static let allTables = [
        "garden",
        "sync_outbox",
        "sync_cursor",
        "sync_conflict",
        "sync_operation_result",
        "media_transfer",
        "local_draft",
    ]

    /// Returns which of `allTables` exist. A separate helper, not an inline
    /// `#expect` per table inside `dbQueue.read`: the macro's expansion does
    /// not propagate a `try` thrown inside that trailing closure cleanly, so
    /// this reads the answers out first and asserts on them afterward.
    private func existingTables(in dbQueue: DatabaseQueue) throws -> Set<String> {
        try dbQueue.read { db in
            Set(try Self.allTables.filter { try db.tableExists($0) })
        }
    }

    private func temporaryDatabasePath() throws -> String {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("CorePersistenceTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("gardens.sqlite").path
    }

    /// The exact schema Phase 2's `FeatureGardens.GardenDatabase` shipped —
    /// hand-written here, deliberately not built from `LocalDatabase
    /// .migrator`'s own `"createGarden"` step, so a future edit to that
    /// migrator cannot silently make this "representative prior schema"
    /// fixture drift along with it.
    private var priorInstalledSchemaMigrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
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
        return migrator
    }

    @Test("A database installed at the Phase 2 schema migrates forward without losing its data")
    func migratesForwardWithoutDataLoss() throws {
        let dbQueue = try DatabaseQueue(path: temporaryDatabasePath())
        try priorInstalledSchemaMigrator.migrate(dbQueue)

        // A real row, as if a Phase 2 install had already synced a garden
        // before this device ever saw a P5-IOS-01 build.
        try dbQueue.write { db in
            try db.execute(
                sql: """
                    INSERT INTO garden (id, name, lifecycleState, callerRole, revision, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    "garden-1", "Backyard", "active", "owner", 3,
                    Date(timeIntervalSince1970: 0), Date(timeIntervalSince1970: 100),
                ]
            )
        }

        try LocalDatabase.migrator.migrate(dbQueue)

        let survivingName = try dbQueue.read { db in
            try String.fetchOne(db, sql: "SELECT name FROM garden WHERE id = ?", arguments: ["garden-1"])
        }
        let survivingRevision = try dbQueue.read { db in
            try Int.fetchOne(db, sql: "SELECT revision FROM garden WHERE id = ?", arguments: ["garden-1"])
        }
        #expect(survivingName == "Backyard")
        #expect(survivingRevision == 3)

        #expect(try existingTables(in: dbQueue) == Set(Self.allTables))
    }

    @Test("A fresh install reaches the same final schema as a migrated-forward one")
    func freshInstallReachesFinalSchema() throws {
        let dbQueue = try DatabaseQueue(path: temporaryDatabasePath())
        try LocalDatabase.migrator.migrate(dbQueue)

        #expect(try existingTables(in: dbQueue) == Set(Self.allTables))
    }

    @Test("Migrating an already-current database again is a safe no-op")
    func migratingTwiceIsSafe() throws {
        let dbQueue = try DatabaseQueue(path: temporaryDatabasePath())
        try LocalDatabase.migrator.migrate(dbQueue)
        try LocalDatabase.migrator.migrate(dbQueue)

        let gardenCount = try dbQueue.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM garden") }
        #expect(gardenCount == 0)
    }

    @Test("LocalDatabase.open reaches the same final schema through the public entry point")
    func openReachesFinalSchema() throws {
        let profileIdentifier = "test-profile-\(UUID().uuidString)"
        let dbQueue = try LocalDatabase.open(profileIdentifier: profileIdentifier)

        #expect(try existingTables(in: dbQueue) == Set(Self.allTables))
    }
}
