import CoreDomain
import Testing

@testable import CoreSynchronization

/// Table-driven coverage of `ConflictRecoveryPolicy.suggestedRecoveryActions
/// (forRecordType:commandType:)` — one row per command type this codebase's
/// five sync record types can actually enqueue, verified against
/// `ConflictRecoveryPolicy`'s own doc comment table so a future edit to
/// either the code or the table catches the other going out of sync.
@Suite("Conflict recovery policy")
struct ConflictRecoveryPolicyTests {
    private struct Case: Sendable, CustomTestStringConvertible {
        let recordType: String
        let commandType: String
        let expected: [ConflictRecoveryAction]

        var testDescription: String { "\(recordType)/\(commandType)" }
    }

    private static let cases: [Case] = [
        // garden
        Case(recordType: "garden", commandType: "gardens.create", expected: [.keepServerVersion, .openForManualReview]),
        Case(
            recordType: "garden", commandType: "gardens.rename",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "garden", commandType: "gardens.archive",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "garden", commandType: "gardens.delete_request",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),

        // gardenObject (Map)
        Case(recordType: "gardenObject", commandType: "map.createObject", expected: [.keepServerVersion, .openForManualReview]),
        Case(
            recordType: "gardenObject", commandType: "map.moveObject",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        ),
        Case(
            recordType: "gardenObject", commandType: "map.replaceGeometry",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        ),
        Case(
            recordType: "gardenObject", commandType: "map.editVertex",
            expected: [.keepServerVersion, .openForManualReview, .duplicateAsNewObject]
        ),
        Case(recordType: "gardenObject", commandType: "map.splitLinework", expected: [.keepServerVersion, .openForManualReview]),
        Case(recordType: "gardenObject", commandType: "map.joinLinework", expected: [.keepServerVersion, .openForManualReview]),
        Case(
            recordType: "gardenObject", commandType: "map.changeProperties",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        ),
        Case(
            recordType: "gardenObject", commandType: "map.assignPlant",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview, .duplicateAsNewObject]
        ),
        Case(
            recordType: "gardenObject", commandType: "map.deleteObject",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "gardenObject", commandType: "map.restoreObject",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(recordType: "gardenObject", commandType: "map.duplicateObject", expected: [.keepServerVersion, .openForManualReview]),

        // plant
        Case(recordType: "plant", commandType: "plants.addPlant", expected: [.keepServerVersion, .openForManualReview]),
        Case(
            recordType: "plant", commandType: "plants.updateDetails",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "plant", commandType: "plants.transitionLifecycleStage",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "plant", commandType: "plants.setStatus",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "plant", commandType: "plants.movePlant",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),

        // task
        Case(recordType: "task", commandType: "tasks.createManualTask", expected: [.keepServerVersion, .openForManualReview]),
        Case(
            recordType: "task", commandType: "tasks.editTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "task", commandType: "tasks.rescheduleTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "task", commandType: "tasks.completeTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "task", commandType: "tasks.dismissTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "task", commandType: "tasks.skipTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),
        Case(
            recordType: "task", commandType: "tasks.deleteTask",
            expected: [.keepServerVersion, .reapplyLocalIntent, .openForManualReview]
        ),

        // observation — never a revision to correct, never a duplicate concept.
        Case(recordType: "observation", commandType: "observations.record", expected: [.keepServerVersion, .openForManualReview]),
        Case(recordType: "observation", commandType: "observations.correct", expected: [.keepServerVersion, .openForManualReview]),

        // A future/unrecognized combination falls back to the conservative baseline.
        Case(recordType: "calibration", commandType: "map.upsertCalibration", expected: [.keepServerVersion, .openForManualReview]),
    ]

    @Test("suggestedRecoveryActions matches the documented per-command-type table", arguments: cases)
    private func matchesTable(_ testCase: Case) {
        let actual = ConflictRecoveryPolicy.suggestedRecoveryActions(
            forRecordType: testCase.recordType, commandType: testCase.commandType
        )

        #expect(actual == testCase.expected, "\(testCase.recordType)/\(testCase.commandType)")
    }

    @Test("duplicateAsNewObject is never offered outside gardenObject, even for a command name that looks map-shaped")
    func duplicateNeverOffersOutsideGardenObject() {
        // `ConflictRecoveryPolicy.isDuplicable` alone would say yes for
        // "map.moveObject" — the record-type gate in
        // `suggestedRecoveryActions` is what actually enforces this.
        let actions = ConflictRecoveryPolicy.suggestedRecoveryActions(forRecordType: "plant", commandType: "map.moveObject")

        #expect(!actions.contains(.duplicateAsNewObject))
    }
}
