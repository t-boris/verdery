import GRDB

/// The P5-IOS-01 migrations: `sync_outbox`, `sync_cursor`, `sync_conflict`,
/// `sync_operation_result`, `media_transfer`, `local_draft` — the six tables
/// architecture/offline-synchronization.md, section "5. Local Tables" adds
/// beyond the local read model(s) `"createGarden"` already demonstrates.
///
/// Split from `LocalDatabase.swift` to keep that file focused on opening and
/// scoping the database; this file is purely schema.
extension LocalDatabase {
    static func registerSynchronizationMigrations(on migrator: inout DatabaseMigrator) {
        // architecture/offline-synchronization.md, section "7. Outbox
        // Operation".
        migrator.registerMigration("createSyncOutbox") { db in
            try db.create(table: "sync_outbox") { table in
                table.column("id", .text).primaryKey()
                table.column("profileId", .text).notNull()
                table.column("gardenId", .text).notNull()
                table.column("commandType", .text).notNull()
                table.column("commandVersion", .integer).notNull()
                table.column("targetRecordIds", .text).notNull()
                table.column("expectedRevision", .integer)
                table.column("payload", .text).notNull()
                table.column("dependencyOperationIds", .text).notNull()
                table.column("mediaPrerequisiteIds", .text).notNull()
                table.column("localSequence", .integer).notNull().unique()
                table.column("retryCount", .integer).notNull()
                table.column("lastErrorCategory", .text)
                table.column("lastAttemptedAt", .datetime)
                table.column("createdAt", .datetime).notNull()
            }
            try db.create(index: "sync_outbox_on_gardenId", on: "sync_outbox", columns: ["gardenId"])
        }

        // architecture/offline-synchronization.md, section "10. Pull
        // Protocol". One durable cursor per garden partition.
        migrator.registerMigration("createSyncCursor") { db in
            try db.create(table: "sync_cursor") { table in
                table.column("gardenId", .text).primaryKey()
                table.column("cursor", .text).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
        }

        // architecture/offline-synchronization.md, section "15. Local
        // Conflict Recovery".
        migrator.registerMigration("createSyncConflict") { db in
            try db.create(table: "sync_conflict") { table in
                table.column("id", .text).primaryKey()
                table.column("originalOperationId", .text).notNull()
                table.column("gardenId", .text).notNull()
                table.column("conflictCode", .text).notNull()
                table.column("localRepresentation", .text).notNull()
                table.column("serverRepresentation", .text).notNull()
                table.column("suggestedRecoveryActions", .text).notNull()
                table.column("resolutionOperationId", .text)
                table.column("createdAt", .datetime).notNull()
                table.column("resolvedAt", .datetime)
            }
            try db.create(index: "sync_conflict_on_gardenId", on: "sync_conflict", columns: ["gardenId"])
        }

        // architecture/offline-synchronization.md, section "8. Push
        // Protocol". One current outcome per operation.
        migrator.registerMigration("createSyncOperationResult") { db in
            try db.create(table: "sync_operation_result") { table in
                table.column("operationId", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("outcome", .text).notNull()
                table.column("serverRevision", .integer)
                table.column("conflictId", .text)
                table.column("detail", .text)
                table.column("receivedAt", .datetime).notNull()
            }
        }

        // architecture/ios-application-design.md, section "13. Media
        // Transfer"; architecture/offline-synchronization.md, section
        // "18. Media Coordination". References only, never binary content.
        migrator.registerMigration("createMediaTransfer") { db in
            try db.create(table: "media_transfer") { table in
                table.column("id", .text).primaryKey()
                table.column("gardenId", .text).notNull()
                table.column("localFileUrl", .text).notNull()
                table.column("checksum", .text)
                table.column("byteCount", .integer)
                table.column("state", .text).notNull()
                table.column("retryCount", .integer).notNull()
                table.column("lastErrorCategory", .text)
                table.column("lastAttemptedAt", .datetime)
                table.column("serverConfirmedAt", .datetime)
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
            try db.create(index: "media_transfer_on_gardenId", on: "media_transfer", columns: ["gardenId"])
        }

        // architecture/ios-application-design.md, section "7. Local
        // Persistence" ("Local-only drafts").
        migrator.registerMigration("createLocalDraft") { db in
            try db.create(table: "local_draft") { table in
                table.column("id", .text).primaryKey()
                table.column("profileId", .text).notNull()
                table.column("gardenId", .text)
                table.column("draftType", .text).notNull()
                table.column("schemaVersion", .integer).notNull()
                table.column("payload", .text).notNull()
                table.column("createdAt", .datetime).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
            try db.create(index: "local_draft_on_profileId", on: "local_draft", columns: ["profileId"])
        }
    }
}
