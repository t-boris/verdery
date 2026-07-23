import CoreDomain
import CoreLocalization
import CorePersistence
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureSyncConflicts

/// Proves `SyncConflictsViewModel`'s own navigation/action-dispatch path:
/// loading the durable open-conflict list, opening one for compare
/// (`select(_:)` — this screen's `openForManualReview` presentation), and
/// dispatching a real resolution action through `ConflictResolvingSyncEngine`.
@Suite("Sync conflicts view model")
@MainActor
struct SyncConflictsViewModelTests {
    private func conflict(
        id: String = "conflict-1",
        gardenId: String = "garden-1",
        suggestedRecoveryActions: [ConflictRecoveryAction] = [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
    ) -> SyncConflict {
        SyncConflict(
            id: id, originalOperationId: "op-1", gardenId: gardenId, recordType: "garden", conflictCode: "staleRevision",
            localRepresentation: #"{"name":"Local"}"#, serverRepresentation: #"{"name":"Server"}"#,
            suggestedRecoveryActions: suggestedRecoveryActions, createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(
        gardenId: String = "garden-1",
        conflictStore: any SyncConflictStore,
        engine: any ConflictResolvingSyncEngine
    ) -> SyncConflictsViewModel {
        SyncConflictsViewModel(
            gardenId: gardenId, conflictStore: conflictStore, engine: engine,
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load populates state from the durable open-conflict list")
    func loadPopulatesState() async {
        let conflictStore = FakeSyncConflictStore()
        await conflictStore.seed(conflict())
        let model = makeModel(conflictStore: conflictStore, engine: FakeEngine())

        await model.load()

        guard case let .loaded(conflicts) = model.state else {
            Issue.record("expected .loaded")
            return
        }
        #expect(conflicts.map(\.id) == ["conflict-1"])
    }

    @Test("load surfaces a failure message when the store throws")
    func loadSurfacesFailure() async {
        let conflictStore = FakeSyncConflictStore()
        await conflictStore.setFailure(TestError.boom)
        let model = makeModel(conflictStore: conflictStore, engine: FakeEngine())

        await model.load()

        guard case .failed = model.state else {
            Issue.record("expected .failed")
            return
        }
    }

    @Test("select opens the compare sheet — this screen's own openForManualReview presentation")
    func selectOpensDetail() async {
        let model = makeModel(conflictStore: FakeSyncConflictStore(), engine: FakeEngine())
        let theConflict = conflict()

        #expect(model.selectedConflict == nil)
        model.select(theConflict)
        #expect(model.selectedConflict == theConflict)

        model.dismissDetail()
        #expect(model.selectedConflict == nil)
    }

    @Test("resolve dispatches the chosen action to the engine, then reloads and dismisses the sheet on success")
    func resolveDispatchesAndReloads() async {
        let conflictStore = FakeSyncConflictStore()
        let theConflict = conflict()
        await conflictStore.seed(theConflict)
        // Simulates `RemoteSyncEngine.resolveConflict`'s own real
        // `keepServerVersion` effect (immediate removal from the durable
        // store) — the view model itself never touches `conflictStore`
        // beyond `fetchOpen`, so this fake's own `resolveConflict` is what
        // stands in for the engine's real side effect on it.
        let engine = FakeEngine(removingFrom: conflictStore)
        let model = makeModel(conflictStore: conflictStore, engine: engine)
        model.select(theConflict)

        await model.resolve(theConflict, action: .keepServerVersion)

        let resolveCalls = await engine.resolveCalls
        #expect(resolveCalls.map { $0.action } == [.keepServerVersion])
        #expect(resolveCalls.map { $0.conflict.id } == ["conflict-1"])
        #expect(model.selectedConflict == nil)
        #expect(model.resolutionErrorMessage == nil)

        guard case let .loaded(conflicts) = model.state else {
            Issue.record("expected .loaded")
            return
        }
        #expect(conflicts.isEmpty)
    }

    @Test("resolve surfaces a failure message and keeps the sheet open when the engine throws")
    func resolveSurfacesFailure() async {
        let conflictStore = FakeSyncConflictStore()
        let theConflict = conflict()
        await conflictStore.seed(theConflict)
        let engine = FakeEngine()
        await engine.setFailure(TestError.boom)
        let model = makeModel(conflictStore: conflictStore, engine: engine)
        model.select(theConflict)

        await model.resolve(theConflict, action: .reapplyLocalIntent)

        #expect(model.resolutionErrorMessage != nil)
        #expect(model.selectedConflict == theConflict, "the sheet must stay open so the user can see the error and retry")
    }

    @Test("title(for:) resolves a non-empty, distinct label for every recovery action")
    func titleForEveryAction() {
        let model = makeModel(conflictStore: FakeSyncConflictStore(), engine: FakeEngine())

        let titles = ConflictRecoveryAction.allCases.map(model.title(for:))

        #expect(titles.allSatisfy { !$0.isEmpty })
        #expect(Set(titles).count == ConflictRecoveryAction.allCases.count)
    }
}

private enum TestError: Error {
    case boom
}

private actor FakeSyncConflictStore: SyncConflictStore {
    private var byId: [String: SyncConflict] = [:]
    private var failure: (any Error)?

    func seed(_ conflict: SyncConflict) {
        byId[conflict.id] = conflict
    }

    func setFailure(_ error: any Error) {
        failure = error
    }

    func record(_ conflict: SyncConflict) async throws {
        byId[conflict.id] = conflict
    }

    func fetchOpen(gardenId: String) async throws -> [SyncConflict] {
        if let failure { throw failure }
        return byId.values.filter { $0.gardenId == gardenId && !$0.isResolved }.sorted { $0.createdAt < $1.createdAt }
    }

    func resolve(conflictId: String, resolutionOperationId: String, at date: Date) async throws {
        if let existing = byId[conflictId] {
            byId[conflictId] = existing.resolving(withOperationId: resolutionOperationId, at: date)
        }
    }

    func remove(conflictId: String) async throws {
        byId[conflictId] = nil
    }
}

private actor FakeEngine: ConflictResolvingSyncEngine {
    private(set) var resolveCalls: [(conflict: SyncConflict, action: ConflictRecoveryAction)] = []
    private var failure: (any Error)?
    private let removingFrom: (any SyncConflictStore)?

    init(removingFrom conflictStore: (any SyncConflictStore)? = nil) {
        self.removingFrom = conflictStore
    }

    func setFailure(_ error: any Error) {
        failure = error
    }

    func resolveConflict(_ conflict: SyncConflict, action: ConflictRecoveryAction) async throws {
        resolveCalls.append((conflict, action))
        if let failure { throw failure }
        try await removingFrom?.remove(conflictId: conflict.id)
    }
}
