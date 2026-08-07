import CoreDomain
import Foundation

/// Encodes small local-only arrays as JSON text columns.
///
/// GRDB has no native array column type; every `sync_*` table that stores a
/// list (target record IDs, dependency operation IDs, suggested recovery
/// actions) stores it as one JSON-encoded `TEXT` column instead, decoded
/// back into a typed array by the record's `domainValue`. A malformed or
/// missing value decodes to `[]` rather than throwing: these arrays are
/// always optional local bookkeeping, never the sole copy of anything a lost
/// element would make unrecoverable.
enum JSONColumnCoding {
    static func encode(_ values: [String]) -> String {
        guard
            let data = try? JSONEncoder().encode(values),
            let text = String(data: data, encoding: .utf8)
        else {
            return "[]"
        }
        return text
    }

    static func decode(_ text: String) -> [String] {
        guard
            let data = text.data(using: .utf8),
            let values = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return values
    }

    static func encode(_ values: [MediaPrerequisite]) -> String {
        guard
            let data = try? JSONEncoder().encode(values),
            let text = String(data: data, encoding: .utf8)
        else {
            return "[]"
        }
        return text
    }

    /// Reads the current shape, and the one that came before it.
    ///
    /// This column used to hold a bare array of media ids. Rows written then
    /// are pending work somebody did offline — the outbox is user-created
    /// data, and ADR-0004 forbids losing it to a migration — so a legacy array
    /// decodes as prerequisites that do not allow a pending upload, which is
    /// exactly the behaviour those rows were enqueued under. No schema
    /// migration is involved: the column is `TEXT` either way, and only the
    /// JSON inside it grew a field.
    static func decodeMediaPrerequisites(_ text: String) -> [MediaPrerequisite] {
        guard let data = text.data(using: .utf8) else { return [] }
        if let values = try? JSONDecoder().decode([MediaPrerequisite].self, from: data) {
            return values
        }
        if let legacyIds = try? JSONDecoder().decode([String].self, from: data) {
            return legacyIds.map { MediaPrerequisite(mediaId: $0) }
        }
        return []
    }
}
