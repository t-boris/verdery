import CoreDomain
import Foundation

/// Fallback and test double for `SyncCursorStore` — no GRDB, no disk I/O.
public actor InMemorySyncCursorStore: SyncCursorStore {
    private var cursorsByGarden: [String: SyncCursor] = [:]

    public init() {}

    public func cursor(forGarden gardenId: String) async throws -> SyncCursor? {
        cursorsByGarden[gardenId]
    }

    public func advance(gardenId: String, cursor: String, at date: Date) async throws {
        cursorsByGarden[gardenId] = SyncCursor(gardenId: gardenId, cursor: cursor, updatedAt: date)
    }

    public func reset(gardenId: String) async throws {
        cursorsByGarden[gardenId] = nil
    }
}
