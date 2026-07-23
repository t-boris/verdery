import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureObservations

/// Coverage for the two offline-capable observation commands
/// (`RecordObservation`, `CorrectObservation`) against a real GRDB database,
/// per architecture/offline-synchronization.md, section "6. Local Mutation
/// Transaction" — the P5-IOS-02 (Stage 4d) counterpart to
/// `FeatureGardensTests.GardensUseCasesTests`/`FeaturePlantsTests
/// .PlantsUseCasesOfflineTests`.
///
/// Neither of these tests configure an `ObservationGateway` at all — neither
/// use case accepts one (see `ObservationsUseCases.swift`) — so a passing
/// suite is itself evidence that recording or correcting an observation
/// while offline never attempts a network call.
@Suite("Observation use cases (offline)")
struct ObservationsUseCasesOfflineTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    /// Decodes an outbox row's stored `payload` as loose JSON, so a test can
    /// assert it matches `packages/api-contracts/openapi.yaml`'s
    /// `SyncObservationOperationPayload`/`SyncObservationCommand`
    /// field-for-field without needing a real server or the generated
    /// OpenAPI models — mirrors `PlantsUseCasesOfflineTests
    /// .decodedPayloadJSON`'s identical purpose.
    private func decodedPayloadJSON(_ operation: OutboxOperation) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(operation.payload.utf8))
        return try #require(object as? [String: Any])
    }

    // MARK: - RecordObservation

    @Test("RecordObservation writes a local projection and an observations.record outbox row")
    func recordObservationOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let recordObservation = RecordObservation(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" },
            generateObservationId: { "obs-1" }
        )
        let observedAt = Date(timeIntervalSince1970: 2_000)

        let result = try await recordObservation(
            gardenId: "garden-1",
            plantId: "plant-1",
            gardenObjectId: nil,
            noteText: "  New growth this week  ",
            conditionSummary: nil,
            observedAt: observedAt
        )

        #expect(result.id == "obs-1")
        #expect(result.gardenId == "garden-1")
        #expect(result.plantId == "plant-1")
        #expect(result.noteText == "New growth this week")
        #expect(result.correctionKind == nil)
        #expect(result.correctsObservationId == nil)
        #expect(result.isCorrected == false)
        #expect(result.observedAt == observedAt)
        #expect(result.recordedAt == Date(timeIntervalSince1970: 1_000))

        let stored = try await store.fetchPending(gardenId: "garden-1")
        #expect(stored == [result])

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operations.count == 1)
        #expect(operation.id == "operation-1")
        #expect(operation.profileId == "profile-1")
        #expect(operation.gardenId == "garden-1")
        #expect(operation.commandType == "observations.record")
        #expect(operation.commandVersion == 1)
        // Only the new observation's own id — there is no "corrected"
        // record for this command to also name.
        #expect(operation.targetRecordIds == ["obs-1"])
        // Observations carry no revision at all — never a guessable `nil`
        // by omission, confirmed directly against `SyncRecordObservationCommand`
        // in `packages/api-contracts/openapi.yaml` (no `expectedRevision`
        // property at all).
        #expect(operation.expectedRevision == nil)

        let json = try decodedPayloadJSON(operation)
        #expect(json["recordType"] as? String == "observation")
        #expect(json["gardenId"] as? String == "garden-1")
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "observations.record")
        #expect(command["observationId"] as? String == "obs-1")
        #expect(command.keys.contains("expectedRevision") == false)
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["plantId"] as? String == "plant-1")
        // A plain `nil` optional (not a `FieldUpdate`, unlike
        // `UpdatePlantDetailsRequestPayload`'s fields) is simply omitted by
        // Swift's synthesized `Encodable`, not encoded as an explicit
        // `null` — schema-valid here since `RecordObservationRequest` has
        // no `required` list, and semantically equivalent to `null` since
        // this request has no "omitted vs. explicit null mean different
        // things" distinction the way a `FieldUpdate`-carrying request does.
        #expect(request.keys.contains("gardenObjectId") == false)
        #expect(request["noteText"] as? String == "New growth this week")
        #expect(request.keys.contains("conditionSummary") == false)
        #expect(request["observedAt"] as? String == "1970-01-01T00:33:20.000Z")
        #expect(request["photoMediaIds"] as? [String] == [])
    }

    @Test("RecordObservation omits observedAt on the wire when the caller did not supply one")
    func recordObservationDefaultsObservedAtToTimestamp() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let recordObservation = RecordObservation(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" },
            generateObservationId: { "obs-1" }
        )

        let result = try await recordObservation(gardenId: "garden-1", noteText: "New growth this week")

        // `null` or omitted means "use the server's own timestamp" per the
        // contract — this client's own local projection resolves that the
        // same way `RecordObservation.execute`'s server-side counterpart
        // does (`input.observedAt ?? now`), so the row it shows immediately
        // already carries a real, displayable time.
        #expect(result.observedAt == Date(timeIntervalSince1970: 1_000))

        let operation = try #require(try await outbox.fetchAll().first)
        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        let request = try #require(command["request"] as? [String: Any])
        #expect(request.keys.contains("observedAt") == false)
    }

    @Test("RecordObservation rejects empty content without writing anything")
    func recordObservationRejectsEmptyContent() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let recordObservation = RecordObservation(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: ObservationCommandError.self) {
            try await recordObservation(gardenId: "garden-1", noteText: "   ", conditionSummary: "  ")
        }

        #expect(failure == .invalidContent)
        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("RecordObservation succeeds with only a condition summary")
    func recordObservationSucceedsWithConditionOnly() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let recordObservation = RecordObservation(localStore: store, profileId: "profile-1")

        let result = try await recordObservation(gardenId: "garden-1", conditionSummary: "Wilting leaves")

        #expect(result.noteText == nil)
        #expect(result.conditionSummary == "Wilting leaves")
    }

    // MARK: - CorrectObservation

    @Test("CorrectObservation writes a local projection and an observations.correct outbox row")
    func correctObservationOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let correctObservation = CorrectObservation(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 5_000) },
            generateOperationId: { "operation-2" },
            generateObservationId: { "obs-2" }
        )

        let result = try await correctObservation(
            gardenId: "garden-1",
            correctedObservationId: "obs-1",
            correctedPlantId: "plant-1",
            correctedGardenObjectId: nil,
            correctionKind: .supersede,
            noteText: "Actually this was misidentified",
            conditionSummary: nil
        )

        #expect(result.id == "obs-2")
        // Copied from the corrected observation, the same way the domain's
        // own `createCorrectionObservation` copies `original.plantId`/
        // `original.gardenObjectId` server-side.
        #expect(result.plantId == "plant-1")
        #expect(result.gardenObjectId == nil)
        #expect(result.correctionKind == .supersede)
        #expect(result.correctsObservationId == "obs-1")
        #expect(result.isCorrected == false)
        // A correction always uses "now" for `observedAt` — there is no
        // caller-supplied time, matching `CorrectObservationRequest`
        // carrying no such field at all.
        #expect(result.observedAt == Date(timeIntervalSince1970: 5_000))

        let stored = try await store.fetchPending(gardenId: "garden-1")
        #expect(stored == [result])

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "observations.correct")
        #expect(operation.gardenId == "garden-1")
        // Only the new correction row's own id — the corrected original is
        // read, not written, by this operation.
        #expect(operation.targetRecordIds == ["obs-2"])
        #expect(operation.expectedRevision == nil)

        let json = try decodedPayloadJSON(operation)
        #expect(json["recordType"] as? String == "observation")
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "observations.correct")
        #expect(command["correctedObservationId"] as? String == "obs-1")
        #expect(command["observationId"] as? String == "obs-2")
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["correctionKind"] as? String == "supersede")
        #expect(request["noteText"] as? String == "Actually this was misidentified")
        #expect(request.keys.contains("conditionSummary") == false)
        #expect(request["photoMediaIds"] as? [String] == [])
        // The wire request carries no plant/garden-object association at
        // all — the server derives both from `correctedObservationId`.
        #expect(request.keys.contains("plantId") == false)
        #expect(request.keys.contains("gardenObjectId") == false)
    }

    @Test("CorrectObservation rejects empty content without writing anything")
    func correctObservationRejectsEmptyContent() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let correctObservation = CorrectObservation(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: ObservationCommandError.self) {
            try await correctObservation(
                gardenId: "garden-1",
                correctedObservationId: "obs-1",
                correctionKind: .amendment,
                noteText: nil,
                conditionSummary: "   "
            )
        }

        #expect(failure == .invalidContent)
        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }
}
