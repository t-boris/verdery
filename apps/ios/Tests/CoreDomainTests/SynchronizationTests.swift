import Foundation
import Testing

@testable import CoreDomain

/// Pure-value-type behavior for the P5-IOS-01 synchronization domain types —
/// no persistence, no I/O.
@Suite("Synchronization domain types")
struct SynchronizationTests {
    @Test("OutboxOperation.assigningLocalSequence only changes localSequence")
    func assigningLocalSequenceOnlyChangesThatField() {
        let operation = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "createObject",
            commandVersion: 1, targetRecordIds: ["a"], expectedRevision: 2, payload: "{}",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let assigned = operation.assigningLocalSequence(7)

        #expect(assigned.localSequence == 7)
        #expect(assigned.id == operation.id)
        #expect(assigned.payload == operation.payload)
        #expect(operation.localSequence == nil)
    }

    @Test("OutboxOperation.recordingAttempt increments the attempt count and keeps the rest")
    func recordingAttemptIncrementsCount() {
        let operation = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "createObject",
            commandVersion: 1, targetRecordIds: [], expectedRevision: nil, payload: "{}",
            createdAt: Date(timeIntervalSince1970: 0)
        )

        let once = operation.recordingAttempt(errorCategory: .connectivity, at: Date(timeIntervalSince1970: 10))
        let twice = once.recordingAttempt(errorCategory: .server, at: Date(timeIntervalSince1970: 20))

        #expect(once.retryState.attemptCount == 1)
        #expect(twice.retryState.attemptCount == 2)
        #expect(twice.retryState.lastErrorCategory == .server)
        #expect(twice.retryState.lastAttemptedAt == Date(timeIntervalSince1970: 20))
    }

    @Test("SyncConflict.resolving sets the resolution operation and resolved date")
    func resolvingSetsResolutionOperation() {
        let conflict = SyncConflict(
            id: "conflict-1", originalOperationId: "op-1", gardenId: "garden-1",
            conflictCode: "staleRevision", localRepresentation: "{}", serverRepresentation: "{}",
            suggestedRecoveryActions: [.keepServerVersion], createdAt: Date(timeIntervalSince1970: 0)
        )
        #expect(!conflict.isResolved)

        let resolved = conflict.resolving(withOperationId: "op-2", at: Date(timeIntervalSince1970: 100))

        #expect(resolved.isResolved)
        #expect(resolved.resolutionOperationId == "op-2")
        #expect(resolved.resolvedAt == Date(timeIntervalSince1970: 100))
        #expect(resolved.originalOperationId == conflict.originalOperationId)
    }

    @Test("RetryState.recordingAttempt increments from any starting count")
    func retryStateRecordingAttemptIncrements() {
        let state = RetryState(attemptCount: 2, lastAttemptedAt: nil, lastErrorCategory: .validation)

        let next = state.recordingAttempt(errorCategory: .authorization, at: Date(timeIntervalSince1970: 1))

        #expect(next.attemptCount == 3)
        #expect(next.lastErrorCategory == .authorization)
    }
}
