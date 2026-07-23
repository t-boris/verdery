import CoreDomain
import Foundation

/// Fallback and test double for `SyncCursorStore` — no GRDB, no disk I/O.
public actor InMemorySyncCursorStore: SyncCursorStore {
    private var stored: SyncCursor?

    public init() {}

    public func current() async throws -> SyncCursor? {
        stored
    }

    public func advance(cursor: String, at date: Date) async throws {
        stored = SyncCursor(cursor: cursor, updatedAt: date)
    }

    public func reset() async throws {
        stored = nil
    }
}
