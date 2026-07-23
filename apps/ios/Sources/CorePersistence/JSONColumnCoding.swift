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
}
