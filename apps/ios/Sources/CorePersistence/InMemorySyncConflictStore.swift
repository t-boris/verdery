import CoreDomain
import Foundation

/// Fallback and test double for `SyncConflictStore` — no GRDB, no disk I/O.
public actor InMemorySyncConflictStore: SyncConflictStore {
    private var conflictsById: [String: SyncConflict] = [:]

    public init() {}

    public func record(_ conflict: SyncConflict) async throws {
        conflictsById[conflict.id] = conflict
    }

    public func fetchOpen(gardenId: String) async throws -> [SyncConflict] {
        conflictsById.values
            .filter { $0.gardenId == gardenId && !$0.isResolved }
            .sorted { $0.createdAt < $1.createdAt }
    }

    public func resolve(conflictId: String, resolutionOperationId: String, at date: Date) async throws {
        guard let conflict = conflictsById[conflictId] else { return }
        conflictsById[conflictId] = conflict.resolving(withOperationId: resolutionOperationId, at: date)
    }

    public func remove(conflictId: String) async throws {
        conflictsById[conflictId] = nil
    }
}
